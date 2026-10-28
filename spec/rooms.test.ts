import { expect, inject, it } from "vitest";
import { SEED_PUZZLES } from "../src/data/puzzles.ts";

// CI never sets GROQ_API_KEY (the course's own LLM proxy key is
// ANU-network-restricted and unreachable from a Fly machine or a GitHub
// runner — see PROCESS.md), so src/llm.ts always falls back to its
// deterministic mock judge here — CI explicitly opts into that fallback via
// ALLOW_MOCK_JUDGE=1 (.github/workflows/checks.yml), since a real deploy
// with neither a key nor that flag set gets "AI judge isn't configured"
// instead of a silent mock (see spec/llm-availability.test.ts). These
// checks exercise the app's own plumbing (room creation, multi-user
// distinction, the live transcript), not the real AI's judgement — that's a
// person's call at a crit, not a spec's.
const baseUrl = inject("baseUrl");

function parseCookie(setCookieHeaders: string[]): string {
  const sessionCookie = setCookieHeaders.find((h) => h.startsWith("turtle_session="));
  if (!sessionCookie) throw new Error("no turtle_session cookie set");
  return sessionCookie.split(";")[0];
}

// Creates a room and immediately starts it as the host, so every existing
// caller's "the room is ready to ask into" assumption still holds under the
// waiting→active lifecycle. Doesn't visit the room page as that session —
// /start only compares session ids, it doesn't register a participant — so
// this still doesn't shift any later visitor's first-visitor numbering.
async function createRoom(): Promise<{ code: string }> {
  const res = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    redirect: "manual",
  });
  expect(res.status).toBe(303);
  const location = res.headers.get("location") ?? "";
  const code = location.split("/").pop() ?? "";
  expect(code).toMatch(/^[A-Z0-9]{5}$/);

  const hostCookie = parseCookie(res.headers.getSetCookie());
  const start = await fetch(new URL(`/rooms/${code}/start`, baseUrl), {
    method: "POST",
    headers: { cookie: hostCookie },
    redirect: "manual",
  });
  expect(start.status).toBe(303);

  return { code };
}

// Visits a room page as a brand-new anonymous session (no cookie passed in)
// and returns the session cookie it was issued, plus the rendered HTML.
async function visitRoom(code: string): Promise<{ cookie: string; html: string }> {
  const res = await fetch(new URL(`/rooms/${code}`, baseUrl), { redirect: "manual" });
  const cookie = parseCookie(res.headers.getSetCookie());
  const html = await res.text();
  return { cookie, html };
}

it("creates a room and serves its page", async () => {
  const { code } = await createRoom();
  const { html } = await visitRoom(code);
  expect(html).toContain(code);
});

it("distinguishes multiple anonymous sessions in the same room", async () => {
  const { code } = await createRoom();

  const { cookie: cookieA, html: htmlA } = await visitRoom(code);
  expect(htmlA).toContain("Anonymous Detective#1");

  // A request with no cookie at all is a second, distinct anonymous session.
  const { cookie: cookieB, html: htmlB } = await visitRoom(code);
  expect(htmlB).toContain("Anonymous Detective#2");

  expect(cookieA).not.toBe(cookieB);
});

it("broadcasts an asked question to the room's live transcript", async () => {
  const { code } = await createRoom();
  const { cookie } = await visitRoom(code);

  const ask = await fetch(new URL(`/rooms/${code}/ask`, baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ question: "this is a test question" }),
    redirect: "manual",
  });
  expect(ask.status).toBe(303);

  const after = await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie } });
  const html = await after.text();
  expect(html).toContain("this is a test question");
});

it("shows an online count on the room page", async () => {
  const { code } = await createRoom();
  const { html } = await visitRoom(code);
  // Nobody has opened the room's SSE stream in this test, so it starts at 0.
  expect(html).toContain("0 people online");
});

it("lists a newly created room on the homepage so others can join it", async () => {
  const { code } = await createRoom();
  const res = await fetch(new URL("/", baseUrl));
  const html = await res.text();
  expect(html).toContain(`/rooms/${code}`);
});

it("shows a not-started case card that flips to in-progress once the host starts it", async () => {
  // Bypasses the createRoom() helper deliberately — that helper auto-starts
  // the room, and this test exists specifically to observe the state before
  // that happens.
  const create = await fetch(new URL("/rooms", baseUrl), { method: "POST", redirect: "manual" });
  const code = (create.headers.get("location") ?? "").split("/").pop() ?? "";
  const hostCookie = parseCookie(create.headers.getSetCookie());

  // Slices to this card's own closing </li>, not a fixed character count —
  // a long room/puzzle title (this shared test DB accumulates many across a
  // session's runs) can otherwise push "Not started yet" past a fixed
  // window with no actual bug involved.
  const before = await (await fetch(new URL("/", baseUrl))).text();
  const cardStart = before.indexOf(`data-code="${code}"`);
  const cardBeforeEnd = before.indexOf("</li>", cardStart);
  expect(before.slice(cardStart, cardBeforeEnd)).toContain("Not started yet");

  await fetch(new URL(`/rooms/${code}/start`, baseUrl), {
    method: "POST",
    headers: { cookie: hostCookie },
    redirect: "manual",
  });

  const after = await (await fetch(new URL("/", baseUrl))).text();
  const cardAfter = after.indexOf(`data-code="${code}"`);
  const cardAfterEnd = after.indexOf("</li>", cardAfter);
  expect(after.slice(cardAfter, cardAfterEnd)).toContain("In progress");
});

it("only the host can start a case", async () => {
  const create = await fetch(new URL("/rooms", baseUrl), { method: "POST", redirect: "manual" });
  const code = (create.headers.get("location") ?? "").split("/").pop() ?? "";

  const { cookie: notHost } = await visitRoom(code);
  const attempt = await fetch(new URL(`/rooms/${code}/start`, baseUrl), {
    method: "POST",
    headers: { cookie: notHost },
    redirect: "manual",
  });
  expect(attempt.status).toBe(303);
  expect(attempt.headers.get("location")).toContain("notice=host-only");

  const stillWaiting = await (await fetch(new URL(`/rooms/${code}`, baseUrl))).text();
  expect(stillWaiting).toContain("Waiting for the host");
});

it("redirects /join?code= to the room, case-insensitively", async () => {
  const { code } = await createRoom();
  const res = await fetch(new URL(`/join?code=${code.toLowerCase()}`, baseUrl), {
    redirect: "manual",
  });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe(`/rooms/${code}`);
});

it("shows a solve recap with stats once a guess is correct", async () => {
  // Picks a known official puzzle explicitly rather than a bare random
  // create + reverse-matching the premise against SEED_PUZZLES: other tests
  // (spec/room-lifecycle.test.ts) share authored puzzles into the same
  // pool pickRandomPuzzle() draws from, so "a fresh room's puzzle is one of
  // SEED_PUZZLES" isn't guaranteed once other tests have run concurrently.
  const picker = await (await fetch(new URL("/rooms/new?mode=existing", baseUrl))).text();
  const match = picker.match(/<option value="([^"]+)">([^<]+) — official/);
  if (!match) throw new Error("no official puzzle found in the picker");
  const [, puzzleId, rawTitle] = match;
  const puzzle = SEED_PUZZLES.find((p) => p.title === rawTitle.trim());
  if (!puzzle) throw new Error(`picker listed an official puzzle not in SEED_PUZZLES: ${rawTitle}`);

  const create = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ mode: "existing", puzzleId }),
    redirect: "manual",
  });
  const code = (create.headers.get("location") ?? "").split("/").pop() ?? "";
  const cookie = parseCookie(create.headers.getSetCookie());
  await fetch(new URL(`/rooms/${code}/start`, baseUrl), {
    method: "POST",
    headers: { cookie },
    redirect: "manual",
  });

  // Solutions are Chinese text (src/data/puzzles.ts) — the mock judge's
  // keyword match (src/llm.ts's judgeWithMock) splits on any run of
  // Unicode letters/digits, which for CJK text means individual
  // characters, not space-separated words. A 2-character run is enough to
  // be a specific, not-generic keyword.
  const word = puzzle.solution.match(/[\p{L}\p{N}]{2,}/u)?.[0];
  if (!word) throw new Error("no usable keyword in this puzzle's solution");

  await fetch(new URL(`/rooms/${code}/ask`, baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ question: word, kind: "guess" }),
  });

  const after = await (
    await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie } })
  ).text();
  expect(after).toContain('class="recap"');
  expect(after).toContain("1 question asked");
  expect(after).toContain("1 participant");
  // The room escapes quotes as &quot; when rendering, so compare against the
  // same escaped form rather than the raw solution text — a few of the seed
  // puzzles' solutions contain a literal " (e.g. a quoted recipe name).
  expect(after).toContain(puzzle.solution.replace(/"/g, "&quot;"));
});

it("never leaks a puzzle's solution to the client while the room is active", async () => {
  const { code } = await createRoom();
  const { html } = await visitRoom(code);
  expect(html).not.toMatch(/data-solved="true"/);
  for (const puzzle of SEED_PUZZLES) {
    expect(html, `room page leaked a solution: "${puzzle.solution}"`).not.toContain(
      puzzle.solution,
    );
  }
});
