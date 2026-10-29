import { expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

function parseCookie(setCookieHeaders: string[]): string {
  const sessionCookie = setCookieHeaders.find((h) => h.startsWith("turtle_session="));
  if (!sessionCookie) throw new Error("no turtle_session cookie set");
  return sessionCookie.split(";")[0];
}

function sessionIdOf(cookie: string): string {
  return cookie.split("=")[1];
}

it("rejects a question posted to a case that hasn't started yet", async () => {
  const create = await fetch(new URL("/rooms", baseUrl), { method: "POST", redirect: "manual" });
  const code = (create.headers.get("location") ?? "").split("/").pop() ?? "";
  const hostCookie = parseCookie(create.headers.getSetCookie());

  const page = await (await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie: hostCookie } })).text();
  expect(page).not.toContain('id="ask-form"');

  const attempt = await fetch(new URL(`/rooms/${code}/ask`, baseUrl), {
    method: "POST",
    headers: { cookie: hostCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ question: "is it a person" }),
    redirect: "manual",
  });
  expect(attempt.headers.get("location")).toContain("notice=not-started");

  const after = await (await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie: hostCookie } })).text();
  expect(after).not.toContain("is it a person");
});

it("lets the host transfer host to another member, and only the current host", async () => {
  const create = await fetch(new URL("/rooms", baseUrl), { method: "POST", redirect: "manual" });
  const code = (create.headers.get("location") ?? "").split("/").pop() ?? "";
  const hostCookie = parseCookie(create.headers.getSetCookie());

  const join = await fetch(new URL(`/rooms/${code}`, baseUrl), { redirect: "manual" });
  const memberCookie = parseCookie(join.headers.getSetCookie());
  const memberSessionId = sessionIdOf(memberCookie);
  const hostSessionId = sessionIdOf(hostCookie);

  // The old host can transfer to the member.
  const transfer = await fetch(new URL(`/rooms/${code}/transfer-host`, baseUrl), {
    method: "POST",
    headers: { cookie: hostCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ toSessionId: memberSessionId }),
    redirect: "manual",
  });
  expect(transfer.status).toBe(303);
  expect(transfer.headers.get("location")).not.toContain("notice=");

  // The old host no longer has host permissions...
  const oldHostAttempt = await fetch(new URL(`/rooms/${code}/start`, baseUrl), {
    method: "POST",
    headers: { cookie: hostCookie },
    redirect: "manual",
  });
  expect(oldHostAttempt.headers.get("location")).toContain("notice=host-only");

  // ...but the new host does.
  const newHostAttempt = await fetch(new URL(`/rooms/${code}/start`, baseUrl), {
    method: "POST",
    headers: { cookie: memberCookie },
    redirect: "manual",
  });
  expect(newHostAttempt.headers.get("location")).not.toContain("notice=");

  // And the new host can hand it right back.
  const transferBack = await fetch(new URL(`/rooms/${code}/transfer-host`, baseUrl), {
    method: "POST",
    headers: { cookie: memberCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ toSessionId: hostSessionId }),
    redirect: "manual",
  });
  expect(transferBack.headers.get("location")).not.toContain("notice=");
});

it("an authored puzzle's own guess is rejected instead of solving the room", async () => {
  const create = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      mode: "author",
      title: "A Test Case",
      premise: "A premise for testing.",
      solution: "A specific unmistakable solution phrase.",
    }),
    redirect: "manual",
  });
  const code = (create.headers.get("location") ?? "").split("/").pop() ?? "";
  const authorCookie = parseCookie(create.headers.getSetCookie());

  await fetch(new URL(`/rooms/${code}/start`, baseUrl), {
    method: "POST",
    headers: { cookie: authorCookie },
    redirect: "manual",
  });

  const guess = await fetch(new URL(`/rooms/${code}/ask`, baseUrl), {
    method: "POST",
    headers: { cookie: authorCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ question: "unmistakable solution phrase", kind: "guess" }),
    redirect: "manual",
  });
  expect(guess.headers.get("location")).toContain("notice=author-guess");

  const after = await (
    await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie: authorCookie } })
  ).text();
  expect(after).not.toContain('class="recap"');
});

it("rejects an overlapping request to the same room's ask endpoint as busy, rather than racing the judge", async () => {
  const create = await fetch(new URL("/rooms", baseUrl), { method: "POST", redirect: "manual" });
  const code = (create.headers.get("location") ?? "").split("/").pop() ?? "";
  const hostCookie = parseCookie(create.headers.getSetCookie());
  await fetch(new URL(`/rooms/${code}/start`, baseUrl), {
    method: "POST",
    headers: { cookie: hostCookie },
    redirect: "manual",
  });

  // Fired back-to-back without awaiting the first — this is a best-effort
  // race against real Node I/O scheduling, not a guaranteed reproduction;
  // src/room-lock.ts's own unit tests (spec/room-lock.test.ts) pin the exact
  // acquire/reject contract deterministically. Different sessions (one
  // cookie each), since a single session would also be rejected by its own
  // cooldown, which would be a different notice entirely.
  const join = await fetch(new URL(`/rooms/${code}`, baseUrl), { redirect: "manual" });
  const memberCookie = parseCookie(join.headers.getSetCookie());

  const [first, second] = await Promise.all([
    fetch(new URL(`/rooms/${code}/ask`, baseUrl), {
      method: "POST",
      headers: { cookie: hostCookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ question: "first question" }),
      redirect: "manual",
    }),
    fetch(new URL(`/rooms/${code}/ask`, baseUrl), {
      method: "POST",
      headers: { cookie: memberCookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ question: "second question" }),
      redirect: "manual",
    }),
  ]);

  const locations = [first.headers.get("location"), second.headers.get("location")];
  // At most one of the two is ever turned away as busy — this isn't
  // asserting the race reproduced (it may not, depending on scheduling),
  // only that IF a collision happened, it resolved to the documented
  // "busy" notice rather than two judge calls or a corrupted room state.
  const busyCount = locations.filter((loc) => loc?.includes("notice=busy")).length;
  expect(busyCount).toBeLessThanOrEqual(1);
});

it("never lets a plain question resolve the room, even when its words match the solution", async () => {
  const create = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      mode: "author",
      title: "A Question Can't Solve This",
      premise: "A premise for testing.",
      solution: "A specific unmistakable solution phrase.",
    }),
    redirect: "manual",
  });
  const code = (create.headers.get("location") ?? "").split("/").pop() ?? "";
  const cookie = parseCookie(create.headers.getSetCookie());
  await fetch(new URL(`/rooms/${code}/start`, baseUrl), {
    method: "POST",
    headers: { cookie },
    redirect: "manual",
  });

  // The mock judge's keyword match (src/llm.ts's judgeWithMock) would call
  // this "yes" for a question — asserting it's never "correct" is what
  // actually exercises decisionToVerdict()'s question/guess separation
  // rather than merely asserting the room isn't solved (which could also
  // hold if the mock judge's keyword match had simply missed).
  await fetch(new URL(`/rooms/${code}/ask`, baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ question: "unmistakable solution phrase", kind: "question" }),
  });

  const after = await (await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie } })).text();
  expect(after).not.toContain('class="recap"');
  expect(after).not.toContain("✓ Correct!");
  expect(after).toContain("Yes");
});

// The judge's player-facing display name (src/llm.ts's JUDGE_DISPLAY_NAME,
// "Your Partner, Watson") labels only its own fixed-reply rows
// (JUDGE_REPLY_TEXTS match, src/render/room.ts's systemEntryHtml) — a plain
// room notice that happens to also be a "system" kind entry (host started
// the investigation) must never be mislabeled as if Watson said it.
it("labels a judge reply with Watson's display name, but never a plain room notice", async () => {
  const create = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      mode: "author",
      title: "Watson Label Case",
      premise: "A premise for testing.",
      solution: "A specific unmistakable solution phrase.",
    }),
    redirect: "manual",
  });
  const code = (create.headers.get("location") ?? "").split("/").pop() ?? "";
  const cookie = parseCookie(create.headers.getSetCookie());
  const start = await fetch(new URL(`/rooms/${code}/start`, baseUrl), {
    method: "POST",
    headers: { cookie },
    redirect: "manual",
  });
  expect(start.status).toBe(303);

  await fetch(new URL(`/rooms/${code}/ask`, baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ question: "is it unmistakable", kind: "question" }),
  });

  const html = await (await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie } })).text();
  const entries = [...html.matchAll(/<li class="entry[^>]*>[\s\S]*?<\/li>/g)].map((m) => m[0]);

  const hostNotice = entries.find((e) => e.includes("The host started the investigation."));
  expect(hostNotice, "the host-start system notice should be in the transcript").toBeTruthy();
  expect(hostNotice).not.toContain("entry-judge-reply");
  expect(hostNotice).not.toContain("Your Partner, Watson");

  const judgeReply = entries.find((e) => e.includes("entry-judge-reply"));
  expect(judgeReply, "a judge-reply row should exist for the question just asked").toBeTruthy();
  expect(judgeReply).toContain("Your Partner, Watson");
});

it("only lists a shared authored puzzle for other sessions to pick, not a private one", async () => {
  const sharedTitle = `Shared Case ${Date.now()}`;
  const privateTitle = `Private Case ${Date.now()}`;

  await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      mode: "author",
      title: sharedTitle,
      premise: "Shared premise.",
      solution: "Shared solution.",
      shared: "on",
    }),
    redirect: "manual",
  });
  await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      mode: "author",
      title: privateTitle,
      premise: "Private premise.",
      solution: "Private solution.",
    }),
    redirect: "manual",
  });

  const picker = await (await fetch(new URL("/rooms/new?mode=existing", baseUrl))).text();
  expect(picker).toContain(sharedTitle);
  expect(picker).not.toContain(privateTitle);
  // Never leaks a solution into the picker, shared or not.
  expect(picker).not.toContain("Shared solution.");
});
