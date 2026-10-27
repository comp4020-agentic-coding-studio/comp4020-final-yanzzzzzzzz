import { expect, inject, it } from "vitest";

// Cumulative reasoning-time accounting (src/db.ts's recordHeartbeat +
// totalReasoningSeconds): the server's own clock decides how much a
// heartbeat is worth, never a client-reported duration. These tests exercise
// real wall-clock gaps against the live app rather than mocking time, same
// as spec/sse.test.ts does for presence — so they sleep for real seconds and
// get a generous per-test timeout rather than a fake clock.
const baseUrl = inject("baseUrl");

function parseCookie(setCookieHeaders: string[]): string {
  const sessionCookie = setCookieHeaders.find((h) => h.startsWith("turtle_session="));
  if (!sessionCookie) throw new Error("no turtle_session cookie set");
  return sessionCookie.split(";")[0];
}

async function createActiveRoom(): Promise<{ code: string; cookie: string }> {
  const create = await fetch(new URL("/rooms", baseUrl), { method: "POST", redirect: "manual" });
  const code = (create.headers.get("location") ?? "").split("/").pop() ?? "";
  const cookie = parseCookie(create.headers.getSetCookie());
  await fetch(new URL(`/rooms/${code}/start`, baseUrl), {
    method: "POST",
    headers: { cookie },
    redirect: "manual",
  });
  // Registers this session as a participant — recordHeartbeat only credits
  // a session that has actually joined the room.
  await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie } });
  return { code, cookie };
}

async function heartbeat(
  code: string,
  cookie: string,
  opts: { resume?: boolean; origin?: string } = {},
): Promise<Response> {
  const body = opts.resume ? new URLSearchParams({ resume: "1" }) : undefined;
  return fetch(new URL(`/rooms/${code}/heartbeat`, baseUrl), {
    method: "POST",
    headers: {
      cookie,
      origin: opts.origin ?? baseUrl,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
}

async function reasoningSecondsNow(): Promise<number> {
  const html = await (await fetch(new URL("/", baseUrl))).text();
  const match = html.match(/data-reasoning-seconds="(\d+)"/);
  if (!match) throw new Error("homepage is missing the reasoning-time total");
  return Number(match[1]);
}

it("rejects a heartbeat from a session that never joined the room", async () => {
  const { code } = await createActiveRoom();
  const res = await fetch(new URL(`/rooms/${code}/heartbeat`, baseUrl), {
    method: "POST",
    headers: { origin: baseUrl },
  });
  expect(res.status).toBe(403);
});

it("rejects a heartbeat for a room that hasn't started yet", async () => {
  const create = await fetch(new URL("/rooms", baseUrl), { method: "POST", redirect: "manual" });
  const code = (create.headers.get("location") ?? "").split("/").pop() ?? "";
  const cookie = parseCookie(create.headers.getSetCookie());
  await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie } });

  const res = await heartbeat(code, cookie);
  expect(res.status).toBe(403);
});

it("rejects a heartbeat whose Origin doesn't match this site", async () => {
  const { code, cookie } = await createActiveRoom();
  const res = await heartbeat(code, cookie, { origin: "https://evil.example" });
  expect(res.status).toBe(403);
});

it(
  "credits real wall-clock time between two heartbeats, not a client-claimed duration",
  async () => {
    const { code, cookie } = await createActiveRoom();
    const before = await reasoningSecondsNow();

    // The first beat after joining only sets a baseline — it can't credit
    // time nothing was observed for.
    const first = await heartbeat(code, cookie, { resume: true });
    expect((await first.json()).credited).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 3_000));

    const second = await heartbeat(code, cookie);
    expect((await second.json()).credited).toBe(true);

    const after = await reasoningSecondsNow();
    expect(after).toBeGreaterThan(before);
    // Credited seconds should be in the ballpark of the real 3s gap, not an
    // arbitrary large number a forged client-side duration could claim.
    expect(after - before).toBeGreaterThanOrEqual(2);
    expect(after - before).toBeLessThan(10);
  },
  15_000,
);

it(
  "does not double-count the same session's overlapping time across two rooms",
  async () => {
    const { code: codeA, cookie } = await createActiveRoom();
    // A second room, same session (same cookie) — simulates a second tab.
    const createB = await fetch(new URL("/rooms", baseUrl), {
      method: "POST",
      headers: { cookie },
      redirect: "manual",
    });
    const codeB = (createB.headers.get("location") ?? "").split("/").pop() ?? "";
    await fetch(new URL(`/rooms/${codeB}/start`, baseUrl), {
      method: "POST",
      headers: { cookie },
      redirect: "manual",
    });
    await fetch(new URL(`/rooms/${codeB}`, baseUrl), { headers: { cookie } });

    const before = await reasoningSecondsNow();
    await heartbeat(codeA, cookie, { resume: true });
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    // Room B's heartbeat, not room A's, observes the same 3s gap for the
    // same session — it should still only be credited once.
    await heartbeat(codeB, cookie);
    const afterOne = await reasoningSecondsNow();
    expect(afterOne - before).toBeGreaterThanOrEqual(2);
    expect(afterOne - before).toBeLessThan(10);

    // An immediate follow-up beat in room A has almost no new elapsed time
    // since room B's beat just moved the shared cursor to now.
    const immediate = await heartbeat(codeA, cookie);
    expect((await immediate.json()).credited).toBe(false);
    const afterTwo = await reasoningSecondsNow();
    expect(afterTwo).toBe(afterOne);
  },
  15_000,
);
