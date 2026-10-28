import { expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

function parseCookie(setCookieHeaders: string[]): string {
  const sessionCookie = setCookieHeaders.find((h) => h.startsWith("turtle_session="));
  if (!sessionCookie) throw new Error("no turtle_session cookie set");
  return sessionCookie.split(";")[0];
}

async function freshCookie(): Promise<string> {
  const res = await fetch(new URL("/", baseUrl), { redirect: "manual" });
  return parseCookie(res.headers.getSetCookie());
}

async function createSharedPuzzle(title: string): Promise<string> {
  await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      mode: "author",
      title,
      premise: `${title} premise.`,
      solution: `${title} solution.`,
      shared: "on",
    }),
    redirect: "manual",
  });
  // The room page itself doesn't expose puzzle_id, so the reliable way to
  // this puzzle's actual id is looking it up by exact title via the same
  // picker /rooms/new?mode=existing already renders.
  const picker = await (await fetch(new URL("/rooms/new?mode=existing", baseUrl))).text();
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = picker.match(new RegExp(`<option value="([0-9a-f-]+)">${escaped}`));
  if (!match) throw new Error(`couldn't find puzzle id for "${title}" in the picker`);
  return match[1];
}

async function createPrivatePuzzleTitle(title: string): Promise<void> {
  await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      mode: "author",
      title,
      premise: `${title} premise.`,
      solution: `${title} solution.`,
    }),
    redirect: "manual",
  });
}

it("marks Community as the current nav item, matching spec/nav.test.ts's pattern for the other nav items", async () => {
  const html = await (await fetch(new URL("/community", baseUrl))).text();
  expect(html).toMatch(/<a href="\/community"[^>]*aria-current="page"[^>]*>Community<\/a>/);
});

it("GET /community with no reviews shows a real empty state, not fabricated content", async () => {
  const puzzleId = await createSharedPuzzle(`Empty State Case ${Date.now()}`);
  const res = await fetch(new URL(`/community?puzzleId=${puzzleId}`, baseUrl));
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toMatch(/No reviews yet/);
});

it("posts a review through PRG, shows success feedback, and the review appears with author/date/rating", async () => {
  const puzzleId = await createSharedPuzzle(`Reviewable Case ${Date.now()}`);
  const cookie = await freshCookie();

  await fetch(new URL("/profile", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ nickname: "Reviewer One", avatar: "🧠" }),
    redirect: "manual",
  });

  const post = await fetch(new URL("/community", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin: baseUrl },
    body: new URLSearchParams({ puzzleId, rating: "4", body: "A genuinely clever twist." }),
    redirect: "manual",
  });
  expect(post.status).toBe(303);
  const location = post.headers.get("location") ?? "";
  expect(location).toContain("saved=1");

  const after = await (
    await fetch(new URL(location, baseUrl), { headers: { cookie } })
  ).text();
  expect(after).toContain("Your review was saved.");
  expect(after).toContain("A genuinely clever twist.");
  expect(after).toContain("Reviewer One");
  expect(after).toContain("🧠");
  expect(after).toMatch(/aria-label="4 out of 5 stars"/);
  expect(after).toMatch(/\d{4}/); // a formatted year appears somewhere in the date
});

it("the review body is escaped, never raw markup, and plain text submissions round-trip safely", async () => {
  const puzzleId = await createSharedPuzzle(`XSS Case ${Date.now()}`);
  const cookie = await freshCookie();
  const payload = "<script>alert('xss')</script> this review is plain text";

  await fetch(new URL("/community", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin: baseUrl },
    body: new URLSearchParams({ puzzleId, body: payload }),
    redirect: "manual",
  });

  const html = await (await fetch(new URL(`/community?puzzleId=${puzzleId}`, baseUrl))).text();
  expect(html).not.toContain("<script>alert('xss')</script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("this review is plain text");
});

it("one review per session per story: the same session updates its own review instead of duplicating it", async () => {
  const puzzleId = await createSharedPuzzle(`Edit Case ${Date.now()}`);
  const cookie = await freshCookie();

  await fetch(new URL("/community", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin: baseUrl },
    body: new URLSearchParams({ puzzleId, rating: "2", body: "First impression, lukewarm." }),
    redirect: "manual",
  });

  // Clears this session's own posting cooldown so the edit below isn't
  // rejected as a rapid repeat — same per-session cooldown this suite checks
  // separately below.
  await new Promise((resolve) => setTimeout(resolve, 5200));

  const update = await fetch(new URL("/community", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin: baseUrl },
    body: new URLSearchParams({ puzzleId, rating: "5", body: "Changed my mind, loved it." }),
    redirect: "manual",
  });
  expect(update.status).toBe(303);

  const html = await (await fetch(new URL(`/community?puzzleId=${puzzleId}`, baseUrl))).text();
  expect(html).toContain("Changed my mind, loved it.");
  expect(html).not.toContain("First impression, lukewarm.");
  expect((html.match(/review-card/g) ?? []).length).toBe(1);
}, 10_000);

it("a different session can't edit or overwrite someone else's review", async () => {
  const puzzleId = await createSharedPuzzle(`Identity Case ${Date.now()}`);
  const cookieA = await freshCookie();
  const cookieB = await freshCookie();
  expect(cookieA).not.toBe(cookieB);

  await fetch(new URL("/community", baseUrl), {
    method: "POST",
    headers: { cookie: cookieA, "content-type": "application/x-www-form-urlencoded", origin: baseUrl },
    body: new URLSearchParams({ puzzleId, body: "Session A's review." }),
    redirect: "manual",
  });
  await fetch(new URL("/community", baseUrl), {
    method: "POST",
    headers: { cookie: cookieB, "content-type": "application/x-www-form-urlencoded", origin: baseUrl },
    body: new URLSearchParams({ puzzleId, body: "Session B's review." }),
    redirect: "manual",
  });

  const html = await (await fetch(new URL(`/community?puzzleId=${puzzleId}`, baseUrl))).text();
  expect(html).toContain("Session A's review.");
  expect(html).toContain("Session B's review.");
  expect((html.match(/review-card/g) ?? []).length).toBe(2);

  // Each session only sees its own "Your review" badge against its own
  // card — the form's own "Your review" field label also contains that
  // text, so this matches only the per-card badge span, not the whole page.
  const viewA = await (
    await fetch(new URL(`/community?puzzleId=${puzzleId}`, baseUrl), { headers: { cookie: cookieA } })
  ).text();
  expect(viewA.match(/<span class="review-mine">Your review<\/span>/g)?.length).toBe(1);
});

it("rejects an empty review and a rating outside 1-5, with the typed body preserved for retry", async () => {
  const puzzleId = await createSharedPuzzle(`Validation Case ${Date.now()}`);
  const cookie = await freshCookie();

  const empty = await fetch(new URL("/community", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin: baseUrl },
    body: new URLSearchParams({ puzzleId, body: "   " }),
    redirect: "manual",
  });
  expect(empty.headers.get("location")).toContain("notice=empty-review");

  const badRating = await fetch(new URL("/community", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin: baseUrl },
    body: new URLSearchParams({ puzzleId, rating: "9", body: "A fine review body." }),
    redirect: "manual",
  });
  expect(badRating.headers.get("location")).toContain("notice=bad-rating");

  const tooLong = await fetch(new URL("/community", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin: baseUrl },
    body: new URLSearchParams({ puzzleId, body: "x".repeat(2001) }),
    redirect: "manual",
  });
  expect(tooLong.headers.get("location")).toContain("notice=too-long");

  const html = await (await fetch(new URL(`/community?puzzleId=${puzzleId}`, baseUrl))).text();
  expect(html).not.toMatch(/review-card/);
});

it("enforces a posting cooldown against rapid repeat submissions from the same session", async () => {
  const puzzleId = await createSharedPuzzle(`Cooldown Case ${Date.now()}`);
  const cookie = await freshCookie();

  const first = await fetch(new URL("/community", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin: baseUrl },
    body: new URLSearchParams({ puzzleId, body: "First submission." }),
    redirect: "manual",
  });
  expect(first.headers.get("location")).toContain("saved=1");

  const second = await fetch(new URL("/community", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin: baseUrl },
    body: new URLSearchParams({ puzzleId, body: "Immediate second submission." }),
    redirect: "manual",
  });
  expect(second.headers.get("location")).toContain("notice=cooldown");
});

it("rejects a cross-origin post the way the room heartbeat does", async () => {
  const puzzleId = await createSharedPuzzle(`Origin Case ${Date.now()}`);
  const res = await fetch(new URL("/community", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://evil.example",
    },
    body: new URLSearchParams({ puzzleId, body: "forged cross-site post" }),
    redirect: "manual",
  });
  expect(res.status).toBe(403);
});

it("a private puzzle can't be reviewed, doesn't leak into the story picker, search, or GET list", async () => {
  const privateTitle = `Private Community Case ${Date.now()}`;
  await createPrivatePuzzleTitle(privateTitle);

  const listHtml = await (await fetch(new URL("/community", baseUrl))).text();
  expect(listHtml).not.toContain(privateTitle);

  // The puzzleId is never exposed by the UI for a private puzzle, so this
  // probes the one id-guessing angle a non-browser client actually has:
  // guessing wrong ids gets the generic rejection, never a selective one
  // that would confirm whether a given id is "private" vs. "doesn't exist."
  const cookie = await freshCookie();
  const reject = await fetch(new URL("/community", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin: baseUrl },
    body: new URLSearchParams({ puzzleId: "00000000-0000-0000-0000-000000000000", body: "trying anyway" }),
    redirect: "manual",
  });
  expect(reject.headers.get("location")).toContain("notice=unavailable-story");
});

it("a spoiler-flagged review renders folded behind a <details> toggle, not shown by default", async () => {
  const puzzleId = await createSharedPuzzle(`Spoiler Case ${Date.now()}`);
  const cookie = await freshCookie();

  await fetch(new URL("/community", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin: baseUrl },
    body: new URLSearchParams({ puzzleId, body: "The killer was the butler all along.", spoiler: "on" }),
    redirect: "manual",
  });

  const html = await (await fetch(new URL(`/community?puzzleId=${puzzleId}`, baseUrl))).text();
  expect(html).toMatch(/<details class="review-spoiler">/);
  expect(html).toContain("Contains spoilers");
  expect(html).toContain("The killer was the butler all along.");
});

it("?puzzleId= on /community filters the list and preselects the story in the post form", async () => {
  const titleA = `Filter Case A ${Date.now()}`;
  const titleB = `Filter Case B ${Date.now()}`;
  const puzzleIdA = await createSharedPuzzle(titleA);
  const puzzleIdB = await createSharedPuzzle(titleB);
  const cookie = await freshCookie();

  await fetch(new URL("/community", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin: baseUrl },
    body: new URLSearchParams({ puzzleId: puzzleIdA, body: "Review only for case A." }),
    redirect: "manual",
  });
  await fetch(new URL("/community", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin: baseUrl },
    body: new URLSearchParams({ puzzleId: puzzleIdB, body: "Review only for case B." }),
    redirect: "manual",
  });

  const filtered = await (await fetch(new URL(`/community?puzzleId=${puzzleIdA}`, baseUrl))).text();
  expect(filtered).toContain("Review only for case A.");
  expect(filtered).not.toContain("Review only for case B.");
  expect(filtered).toContain(`value="${puzzleIdA}" selected`);
});

it("the case library links each story to its community reviews, preselecting that story", async () => {
  const title = `Linked Case ${Date.now()}`;
  const puzzleId = await createSharedPuzzle(title);
  const html = await (await fetch(new URL("/cases", baseUrl))).text();
  expect(html).toContain(`href="/community?puzzleId=${puzzleId}"`);
});

it("never mixes a room's shared in-game transcript into the community reviews page", async () => {
  const puzzleId = await createSharedPuzzle(`No Mixing Case ${Date.now()}`);
  const create = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ mode: "existing", puzzleId }),
    redirect: "manual",
  });
  const code = (create.headers.get("location") ?? "").split("/").pop() ?? "";
  const cookie = parseCookie(create.headers.getSetCookie());
  await fetch(new URL(`/rooms/${code}/start`, baseUrl), { method: "POST", headers: { cookie }, redirect: "manual" });
  await fetch(new URL(`/rooms/${code}/ask`, baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ question: "a totally unique in-room question string", kind: "question" }),
    redirect: "manual",
  });

  const communityHtml = await (await fetch(new URL(`/community?puzzleId=${puzzleId}`, baseUrl))).text();
  expect(communityHtml).not.toContain("a totally unique in-room question string");
});
