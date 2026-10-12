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
