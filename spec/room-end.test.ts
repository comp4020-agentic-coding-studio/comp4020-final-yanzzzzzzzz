import { expect, inject, it } from "vitest";
import { JSDOM } from "jsdom";

const baseUrl = inject("baseUrl");

function parseCookie(setCookieHeaders: string[]): string {
  const sessionCookie = setCookieHeaders.find((h) => h.startsWith("turtle_session="));
  if (!sessionCookie) throw new Error("no turtle_session cookie set");
  return sessionCookie.split(";")[0];
}

async function createRoom(): Promise<{ code: string; hostCookie: string }> {
  const create = await fetch(new URL("/rooms", baseUrl), { method: "POST", redirect: "manual" });
  const code = (create.headers.get("location") ?? "").split("/").pop() ?? "";
  const hostCookie = parseCookie(create.headers.getSetCookie());
  return { code, hostCookie };
}

async function joinRoom(code: string): Promise<string> {
  const join = await fetch(new URL(`/rooms/${code}`, baseUrl), { redirect: "manual" });
  return parseCookie(join.headers.getSetCookie());
}

async function endRoom(code: string, cookie: string) {
  return fetch(new URL(`/rooms/${code}/end`, baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: "confirm=end",
    redirect: "manual",
  });
}

it("lets the host end a waiting (not-yet-started) case, keeping it unsolved", async () => {
  const { code, hostCookie } = await createRoom();

  const confirmPage = await (
    await fetch(new URL(`/rooms/${code}/end`, baseUrl), { headers: { cookie: hostCookie } })
  ).text();
  expect(confirmPage).toContain("End investigation?");
  expect(confirmPage).toContain(`action="/rooms/${code}/end"`);
  expect(confirmPage).toContain(`href="/rooms/${code}"`); // cancel link

  const res = await endRoom(code, hostCookie);
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).not.toContain("notice=");

  const page = await (await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie: hostCookie } })).text();
  expect(page).toContain("Investigation ended");
  expect(page.toLowerCase()).toContain("unsolved");
  expect(page).not.toContain('id="ask-form"');
});

it("lets the host end an active case, keeping the transcript but blocking further questions", async () => {
  const { code, hostCookie } = await createRoom();
  await fetch(new URL(`/rooms/${code}/start`, baseUrl), { method: "POST", headers: { cookie: hostCookie } });

  const res = await endRoom(code, hostCookie);
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).not.toContain("notice=");

  const page = await (await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie: hostCookie } })).text();
  expect(page).toContain("Investigation ended");
  expect(page).not.toContain('id="ask-form"');
  // No solution leakage, no solved-count framing for a host-ended case.
  expect(page).not.toContain("Case solved!");
  expect(page).not.toContain("participant");

  const askAttempt = await fetch(new URL(`/rooms/${code}/ask`, baseUrl), {
    method: "POST",
    headers: { cookie: hostCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ question: "is it raining" }),
    redirect: "manual",
  });
  expect(askAttempt.status).toBe(303);
  expect(askAttempt.headers.get("location")).toBe(`/rooms/${code}`);
  const after = await (await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie: hostCookie } })).text();
  expect(after).not.toContain("is it raining");
});

it("rejects a non-host trying to end the case", async () => {
  const { code, hostCookie } = await createRoom();
  const memberCookie = await joinRoom(code);

  const res = await endRoom(code, memberCookie);
  expect(res.headers.get("location")).toContain("notice=host-only");

  const page = await (await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie: hostCookie } })).text();
  expect(page).not.toContain("Investigation ended");
});

it("rejects a cross-origin end request", async () => {
  const { code, hostCookie } = await createRoom();

  const res = await fetch(new URL(`/rooms/${code}/end`, baseUrl), {
    method: "POST",
    headers: {
      cookie: hostCookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    },
    body: "confirm=end",
    redirect: "manual",
  });
  expect(res.status).toBe(403);
});

it("requires the explicit confirm=end field — a bare POST never ends the case", async () => {
  const { code, hostCookie } = await createRoom();

  const res = await fetch(new URL(`/rooms/${code}/end`, baseUrl), {
    method: "POST",
    headers: { cookie: hostCookie, "content-type": "application/x-www-form-urlencoded" },
    body: "",
    redirect: "manual",
  });
  expect(res.headers.get("location")).toContain("notice=confirm-required");

  const page = await (await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie: hostCookie } })).text();
  expect(page).not.toContain("Investigation ended");
});

it("ending twice is idempotent — the second attempt is a friendly no-op, not an error or a second notice row", async () => {
  const { code, hostCookie } = await createRoom();

  const first = await endRoom(code, hostCookie);
  expect(first.status).toBe(303);

  const second = await endRoom(code, hostCookie);
  expect(second.headers.get("location")).toContain("notice=already-over");

  const page = await (await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie: hostCookie } })).text();
  const dom = new JSDOM(page);
  const transcript = dom.window.document.querySelector("ul#transcript");
  const rows = Array.from(transcript?.querySelectorAll("li") ?? []).filter((li) =>
    li.textContent?.includes("The host ended this investigation"),
  );
  expect(rows).toHaveLength(1);
});

it("a closed room can never become solved afterward", async () => {
  const { code, hostCookie } = await createRoom();
  await fetch(new URL(`/rooms/${code}/start`, baseUrl), { method: "POST", headers: { cookie: hostCookie } });
  await endRoom(code, hostCookie);

  const guessAttempt = await fetch(new URL(`/rooms/${code}/ask`, baseUrl), {
    method: "POST",
    headers: { cookie: hostCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ question: "it was the butler", kind: "guess" }),
    redirect: "manual",
  });
  expect(guessAttempt.status).toBe(303);

  const page = await (await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie: hostCookie } })).text();
  expect(page).toContain("Investigation ended");
  expect(page).not.toContain("Case solved!");
  expect(page).not.toContain("it was the butler");
});

it("the end confirmation page itself is host-only", async () => {
  const { code, hostCookie } = await createRoom();
  const memberCookie = await joinRoom(code);

  const res = await fetch(new URL(`/rooms/${code}/end`, baseUrl), {
    headers: { cookie: memberCookie },
    redirect: "manual",
  });
  expect(res.headers.get("location")).toContain("notice=host-only");
});

it("pushes a room-status SSE event and a lobby-remove event when the host ends the case", async () => {
  const { code, hostCookie } = await createRoom();

  const stream = await fetch(new URL(`/rooms/${code}/stream`, baseUrl), { headers: { cookie: hostCookie } });
  const lobbyStream = await fetch(new URL(`/lobby/stream`, baseUrl));
  const reader = stream.body!.getReader();
  const lobbyReader = lobbyStream.body!.getReader();
  const decoder = new TextDecoder();

  async function readUntil(haystack: string, reader: ReadableStreamDefaultReader<Uint8Array>, getBuf: () => string, setBuf: (s: string) => void) {
    for (let i = 0; i < 50; i++) {
      if (getBuf().includes(haystack)) return;
      const { value, done } = await reader.read();
      if (done) return;
      setBuf(getBuf() + decoder.decode(value));
    }
  }

  let roomBuf = "";
  let lobbyBuf = "";
  await readUntil("event: presence", reader, () => roomBuf, (s) => (roomBuf = s));
  await readUntil("event: snapshot", lobbyReader, () => lobbyBuf, (s) => (lobbyBuf = s));

  await endRoom(code, hostCookie);

  roomBuf = "";
  lobbyBuf = "";
  await readUntil("event: room-status", reader, () => roomBuf, (s) => (roomBuf = s));
  expect(roomBuf).toContain("event: room-status");
  expect(roomBuf).toContain("closedAt");

  await readUntil("event: lobby-remove", lobbyReader, () => lobbyBuf, (s) => (lobbyBuf = s));
  expect(lobbyBuf).toContain("event: lobby-remove");
  expect(lobbyBuf).toContain(code);

  await reader.cancel();
  await lobbyReader.cancel();
});

it("sends a room-snapshot event right after connecting, reflecting a close that happened while offline", async () => {
  const { code, hostCookie } = await createRoom();

  // Simulate a viewer who was offline for the entire close: no stream open
  // at all until after endRoom() below, so the only way this connection can
  // ever learn the room closed is the room-snapshot sent at subscribe time
  // (never the room-status broadcast, which only reaches connections that
  // were already open when the close happened).
  await endRoom(code, hostCookie);

  const stream = await fetch(new URL(`/rooms/${code}/stream`, baseUrl), { headers: { cookie: hostCookie } });
  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();

  let buf = "";
  for (let i = 0; i < 50; i++) {
    if (buf.includes("event: room-snapshot")) break;
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value);
  }

  expect(buf).toContain("event: room-snapshot");
  const dataLine = buf.split("\n").find((l) => l.startsWith("data: ") && l.includes("closedAt"));
  expect(dataLine).toBeDefined();
  const snapshot = JSON.parse(dataLine!.slice("data: ".length));
  expect(snapshot.status).toBe("waiting");
  expect(snapshot.closedAt).not.toBeNull();
  expect(snapshot.hostSessionId).toBeTruthy();

  await reader.cancel();
});
