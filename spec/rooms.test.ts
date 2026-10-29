import { expect, inject, it } from "vitest";
import { SEED_PUZZLES } from "../src/data/puzzles.ts";

// CI never sets GEMINI_API_KEY (the course's own LLM proxy key is
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
  expect(htmlA).toContain("Mystery Detective #1");

  // A request with no cookie at all is a second, distinct anonymous session.
  const { cookie: cookieB, html: htmlB } = await visitRoom(code);
  expect(htmlB).toContain("Mystery Detective #2");

  expect(cookieA).not.toBe(cookieB);
});

// The default auto-label's exact English text and per-room numbering
// (src/db.ts's ensureParticipantLabel()) — a real user report was the
// default following the browser's locale via the native file-input chrome
// elsewhere on the site; this pins the room-identity default itself to a
// fixed, stable English string, never re-numbered on a later visit from the
// same session.
it("keeps the same session's default label stable across repeat visits to the same room", async () => {
  const { code } = await createRoom();
  const { cookie, html: first } = await visitRoom(code);
  expect(first).toContain("Mystery Detective #1");

  const again = await (await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie } })).text();
  expect(again).toContain("Mystery Detective #1");
  expect(again).not.toContain("Mystery Detective #2");
});

it("a custom nickname is shown instead of the auto-label, and is never itself reformatted", async () => {
  const { code } = await createRoom();
  const first = await fetch(new URL("/", baseUrl), { redirect: "manual" });
  const cookie = parseCookie(first.headers.getSetCookie());

  await fetch(new URL("/profile", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ nickname: "Mystery Fanclub", avatar: "" }),
    redirect: "manual",
  });

  const html = await (await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie } })).text();
  // A nickname that happens to start with "Mystery" (but doesn't match the
  // exact auto-label pattern "Mystery Detective #N") must render completely
  // untouched — formatAutoLabel() only ever reformats the exact legacy
  // auto-generated shape, never a custom nickname that merely looks similar.
  expect(html).toContain("Mystery Fanclub");
  expect(html).not.toContain("Mystery Detective #1");
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

// Regression test for a real root-reviewed bug: src/render/room.ts marks an
// entry's own <li> with a class of "entry-question" or "entry-guess" (via
// `entry-${entry.kind}`) to say what KIND of row it is — a different meaning
// from the two <p class="entry-question">/<p class="entry-verdict"> text
// paragraphs inside it. An unscoped `.entry-question { white-space: pre-wrap
// }` in public/styles.css collided with the LI's OWN class of the same name
// and forced block-level pre-wrap spacing onto the whole bubble, inflating a
// one-line question's rendered height well past what three short paragraphs
// should take. This doesn't run a real browser layout engine — it instead
// pins the two rules this bug depends on never regressing together: the
// scoped selector descendant-combines through ".entry > p", and the LI kind
// class and the P text class are never merged back into one bare selector.
it("scopes the transcript's pre-wrap text styling to the <p> children, never colliding with the <li>'s own entry-question/entry-guess kind class", async () => {
  const css = await (await fetch(new URL("/styles.css", baseUrl))).text();
  expect(css).toMatch(/\.entry\s*>\s*p\.entry-question\s*,\s*\.entry\s*>\s*p\.entry-verdict\s*\{[^}]*white-space:\s*pre-wrap/);
  // A bare, unscoped selector starting a line with ".entry-question," (no
  // ".entry > p." prefix) is exactly the regression this guards against — it
  // would match the LI's own "entry-${kind}" class again, not just the <p>.
  expect(css).not.toMatch(/^\s*\.entry-question\s*,/m);
});

it("rejects a question/guess over the character limit with an explicit notice, never silently truncating it before judging", async () => {
  const { code } = await createRoom();
  const { cookie } = await visitRoom(code);

  const atLimit = "a".repeat(2000);
  const okRes = await fetch(new URL(`/rooms/${code}/ask`, baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ question: atLimit, kind: "question" }),
    redirect: "manual",
  });
  expect(okRes.status).toBe(303);
  expect(okRes.headers.get("location")).not.toContain("notice=too-long");
  const afterOk = await (await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie } })).text();
  expect(afterOk).toContain(atLimit);

  const overLimit = "b".repeat(2001);
  const rejectRes = await fetch(new URL(`/rooms/${code}/ask`, baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ question: overLimit, kind: "question" }),
    redirect: "manual",
  });
  expect(rejectRes.status).toBe(303);
  expect(rejectRes.headers.get("location")).toContain("notice=too-long");

  // Never partially stored, let alone judged — the rejected text (or any
  // truncated prefix of it) never reaches the transcript at all.
  const afterReject = await (
    await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie } })
  ).text();
  expect(afterReject).not.toContain(overLimit);
  expect(afterReject).not.toContain("b".repeat(2000));
});
