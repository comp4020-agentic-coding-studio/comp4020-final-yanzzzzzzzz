import { expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

function parseCookie(setCookieHeaders: string[]): string {
  const sessionCookie = setCookieHeaders.find((h) => h.startsWith("turtle_session="));
  if (!sessionCookie) throw new Error("no turtle_session cookie set");
  return sessionCookie.split(";")[0];
}

it("homepage sends 'Start a new case' and 'Browse every case' to two different places", async () => {
  const res = await fetch(new URL("/", baseUrl));
  const html = await res.text();
  const start = html.match(/<a href="([^"]+)" class="button-link">Start a new case<\/a>/);
  const browse = html.match(/<a href="([^"]+)" class="button-link-outline">Browse every case<\/a>/);
  expect(start?.[1]).toBe("/rooms/new");
  expect(browse?.[1]).toBe("/cases");
  expect(start?.[1]).not.toBe(browse?.[1]);
});

it("/cases lists public cases with a Play action, but never a solution", async () => {
  const res = await fetch(new URL("/cases", baseUrl));
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("A Bowl of Turtle Soup");
  expect(html).toContain("Play this case");
  // The built-in puzzle's solution text must never reach this page.
  expect(html).not.toContain("companions, surviving");
});

it("/cases search filters by title/premise, escapes input, and reports no results", async () => {
  const hit = await (await fetch(new URL("/cases?q=turtle", baseUrl))).text();
  expect(hit).toContain("A Bowl of Turtle Soup");

  const miss = await (
    await fetch(new URL("/cases?q=zzzz-nothing-should-ever-match-this-zzzz", baseUrl))
  ).text();
  expect(miss).not.toContain("A Bowl of Turtle Soup");
  expect(miss).toMatch(/No cases match/);

  const xss = await (
    await fetch(new URL(`/cases?q=${encodeURIComponent('<script>alert(1)</script>')}`, baseUrl))
  ).text();
  expect(xss).not.toContain("<script>alert(1)</script>");
});

it("/cases never lists a private authored puzzle, and its Play link never leaks via /rooms/new?puzzleId=", async () => {
  const privateTitle = `Private Browse Case ${Date.now()}`;
  const create = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      mode: "author",
      title: privateTitle,
      premise: "Private browse premise.",
      solution: "Private browse solution.",
    }),
    redirect: "manual",
  });
  const code = (create.headers.get("location") ?? "").split("/").pop() ?? "";
  expect(code).toMatch(/^[A-Z0-9]{5}$/);

  const authorCookie = parseCookie(create.headers.getSetCookie());
  // Confirms the room itself still works for its author (sanity check on the
  // fixture), then checks the two pages a stranger could browse to.
  const roomRes = await fetch(new URL(`/rooms/${code}`, baseUrl), {
    headers: { cookie: authorCookie },
  });
  expect(roomRes.status).toBe(200);

  const casesHtml = await (await fetch(new URL("/cases", baseUrl))).text();
  expect(casesHtml).not.toContain(privateTitle);

  const pickerHtml = await (await fetch(new URL("/rooms/new?mode=existing", baseUrl))).text();
  expect(pickerHtml).not.toContain(privateTitle);
});

it("GET /rooms/new?puzzleId= preselects a real public puzzle, and the created room uses it", async () => {
  const picker = await (await fetch(new URL("/rooms/new?mode=existing", baseUrl))).text();
  const optionMatch = picker.match(/<option value="([0-9a-f-]+)">The Elevator Routine/);
  const puzzleId = optionMatch?.[1];
  expect(puzzleId, "The Elevator Routine should be a pickable option").toBeTruthy();

  const preselected = await (
    await fetch(new URL(`/rooms/new?puzzleId=${puzzleId}`, baseUrl))
  ).text();
  expect(preselected).toContain(`value="${puzzleId}" selected`);

  const create = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ mode: "existing", puzzleId: puzzleId! }),
    redirect: "manual",
  });
  const code = (create.headers.get("location") ?? "").split("/").pop() ?? "";
  const cookie = parseCookie(create.headers.getSetCookie());
  const roomHtml = await (
    await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie } })
  ).text();
  expect(roomHtml).toContain("The Elevator Routine");
});

it("GET /rooms/new?puzzleId= ignores an invalid or nonexistent id instead of erroring or leaking", async () => {
  const res = await fetch(new URL("/rooms/new?puzzleId=not-a-real-id", baseUrl));
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).not.toMatch(/value="not-a-real-id" selected/);
});
