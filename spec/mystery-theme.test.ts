import { expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

// Covers the visual rework's real, checkable claims — image paths, the
// slug→cover mapping, the case-library source filter, and that the page is
// fully usable with no JavaScript at all — without asserting on exact CSS
// values (a snapshot of the stylesheet would just re-break on every future
// styling tweak with no bug behind it).

it("the homepage hero ships a real responsive image, eager and high-priority, not a placeholder", async () => {
  const html = await (await fetch(new URL("/", baseUrl))).text();
  expect(html).toMatch(/<picture class="hero-media">/);
  expect(html).toMatch(/srcset="[^"]*hero-mystery-640\.webp[^"]*hero-mystery-1200\.webp[^"]*hero-mystery-1600\.webp/);
  expect(html).toMatch(/<img\s[^>]*src="[^"]*hero-mystery-1200\.jpg[^"]*"[^>]*fetchpriority="high"/);
  // No lazy-loading on the one image that has to be visible immediately.
  const imgTag = html.match(/<img\s[^>]*hero-mystery-1200\.jpg[^>]*>/)?.[0] ?? "";
  expect(imgTag).not.toContain('loading="lazy"');

  // Every first-party image URL actually resolves (not a 404 placeholder).
  for (const src of html.matchAll(/src="(\/images\/mystery\/[^"]+)"/g)) {
    const res = await fetch(new URL(src[1], baseUrl));
    expect(res.status, `${src[1]} should be served`).toBe(200);
  }
});

it("case library and card cover images are lazy-loaded with explicit dimensions to prevent layout shift", async () => {
  const html = await (await fetch(new URL("/cases", baseUrl))).text();
  const coverImgs = [...html.matchAll(/<img\s[^>]*class="case-browse-cover"[^>]*>/g)].map((m) => m[0]);
  expect(coverImgs.length).toBeGreaterThan(0);
  for (const tag of coverImgs) {
    expect(tag).toContain('loading="lazy"');
    expect(tag).toMatch(/width="\d+"/);
    expect(tag).toMatch(/height="\d+"/);
  }
});

it("maps all eight built-in puzzles to their own unique dedicated cover by slug", async () => {
  const BUILT_IN_COVERS: [query: string, cover: string][] = [
    ["turtle", "case-soup.webp"],
    ["silent", "case-phone.webp"],
    ["elevator", "case-elevator.webp"],
    ["desert", "case-desert.webp"],
    ["gas station", "case-gas-station.webp"],
    ["discarded shoes", "case-shoes.webp"],
    ["straw", "case-straw.webp"],
    ["dinner party", "case-dinner.webp"],
  ];

  const covers = new Set<string>();
  for (const [query, cover] of BUILT_IN_COVERS) {
    const html = await (await fetch(new URL(`/cases?q=${encodeURIComponent(query)}`, baseUrl))).text();
    expect(html, `?q=${query} should show ${cover}`).toContain(`/images/mystery/${cover}`);
    covers.add(cover);
  }
  // Every built-in puzzle's own commission is a distinct file — none of the
  // eight accidentally share a cover (which would defeat the point of
  // commissioning eight separate images).
  expect(covers.size).toBe(BUILT_IN_COVERS.length);

  // Each dedicated cover actually resolves as a real, small image, not a
  // 404 placeholder or an oversized file left over from the source PNG.
  for (const [, cover] of BUILT_IN_COVERS) {
    const res = await fetch(new URL(`/images/mystery/${cover}`, baseUrl));
    expect(res.status, `${cover} should be served`).toBe(200);
    const bytes = await res.arrayBuffer();
    expect(bytes.byteLength, `${cover} should be a compressed derivative, not the multi-MB source`).toBeLessThan(
      500 * 1024,
    );
  }
});

it("a built-in with no dedicated commission would fall back to the shared archive cover, never a broken image", async () => {
  // All eight built-ins now have dedicated covers (checked above); this
  // documents the fallback path itself still exists and still works for the
  // only case that can still hit it — a player-authored shared puzzle with
  // no uploaded cover of its own.
  const title = `No-Cover Fallback Case ${Date.now()}`;
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
  const html = await (await fetch(new URL(`/cases?q=${encodeURIComponent(title)}`, baseUrl))).text();
  expect(html).toContain(title);
  expect(html).toContain("/images/mystery/case-archive.webp");
});

it("the case library's All/Built-in/Player-created filter actually filters, not just labels", async () => {
  const title = `Mystery Theme Filter Case ${Date.now()}`;
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

  const all = await (await fetch(new URL("/cases", baseUrl))).text();
  expect(all).toContain(title);
  expect(all).toContain("A Bowl of Turtle Soup");

  const builtinOnly = await (await fetch(new URL("/cases?source=builtin", baseUrl))).text();
  expect(builtinOnly).toContain("A Bowl of Turtle Soup");
  expect(builtinOnly).not.toContain(title);

  const playerOnly = await (await fetch(new URL("/cases?source=player", baseUrl))).text();
  expect(playerOnly).toContain(title);
  expect(playerOnly).not.toContain("A Bowl of Turtle Soup");

  // The active tab is marked, and a search term survives switching tabs.
  const builtinSearch = await (
    await fetch(new URL("/cases?source=builtin&q=turtle", baseUrl))
  ).text();
  expect(builtinSearch).toMatch(/<a href="\/cases\?q=turtle&source=builtin"[^>]*class="active"/);
  expect(builtinSearch).toContain("A Bowl of Turtle Soup");
});

it("the homepage, hero actions, and case library all render fully without executing any JavaScript", async () => {
  // A plain fetch (as every other test in this file already does) never
  // executes <script> tags — this just makes the "no-JS" guarantee explicit
  // as its own check: the content a player needs has to already be present
  // in the server response, not injected afterward by lobby.js.
  const home = await (await fetch(new URL("/", baseUrl))).text();
  expect(home).toContain("Every strange ending hides a story.");
  expect(home).toContain("Ask together. Uncover the truth.");
  expect(home).toMatch(/<a href="\/rooms\/new" class="[^"]*">Create a room<\/a>/);
  expect(home).toMatch(/<a href="\/cases" class="[^"]*">Explore cases<\/a>/);
  // The join-by-code control is a real <form> that works without JS.
  expect(home).toMatch(/<form method="get" action="\/join" class="join-form">/);

  const cases = await (await fetch(new URL("/cases", baseUrl))).text();
  expect(cases).toContain("Case Library");
  expect(cases).toMatch(/<a href="\/rooms\/new\?puzzleId=[^"]+" class="[^"]*">Play this case<\/a>/);
});

it("ships a prefers-reduced-motion guard for every new ambient animation, same pattern as the existing steam/FAQ guards", async () => {
  const css = await (await fetch(new URL("/styles.css", baseUrl))).text();
  // Ambient hero mist and card entrance fades are both opt-in via
  // no-preference, exactly like the pre-existing FAQ-arrow transition — not
  // left unconditional.
  expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{[^}]*mist-drift/s);
  expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{[^}]*fade-in-up/s);
  // And the hover-lift/zoom transitions on cards are explicitly turned off
  // under reduce, not just omitted from a no-preference block (an omitted
  // transition still plays; an explicit "transition: none" guarantees it
  // doesn't).
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^]*?transition: none/);
});

it("never fabricates room counts, difficulty, or ratings — only real derived numbers appear", async () => {
  const home = await (await fetch(new URL("/", baseUrl))).text();
  // The reasoning-time stat carries its real source value as a data
  // attribute (already covered by spec/reasoning-time.test.ts); this just
  // confirms the homepage doesn't also render an invented secondary stat
  // (a star rating, a fake player count, a difficulty label) anywhere near it.
  expect(home).not.toMatch(/difficulty/i);
  expect(home).not.toMatch(/★|☆/); // star ratings belong to /community only
});

// ---------- Lobby/home room-card thumbnails (src/render/home.ts, public/lobby.js) ----------
// A room playing a built-in puzzle shows that puzzle's own dedicated cover;
// a room playing a private (unshared) authored puzzle still shows its
// uploaded cover to any lobby viewer, through a narrower room-code-scoped
// route than GET /uploads/cover/:puzzleId (which requires already having
// joined, or the puzzle being shared) — see src/render/covers.ts's
// coverForRoom() and src/db.ts's getListedRoomCoverPath().

function parseSessionCookie(setCookieHeaders: string[]): string {
  const c = setCookieHeaders.find((h) => h.startsWith("turtle_session="));
  if (!c) throw new Error("no turtle_session cookie set");
  return c.split(";")[0];
}

function findCardByCode(html: string, code: string): string {
  const marker = `data-code="${code}"`;
  const start = html.lastIndexOf("<li", html.indexOf(marker));
  const end = html.indexOf("</li>", start);
  return html.slice(start, end);
}

it("the homepage's open-cases lobby shows a real cover thumbnail for every room, resolved server-side", async () => {
  await fetch(new URL("/rooms", baseUrl), { method: "POST", redirect: "manual" }); // ensure at least one room
  const html = await (await fetch(new URL("/", baseUrl))).text();
  const cards = [...html.matchAll(/<li class="case-card"[^>]*>[\s\S]*?<\/li>/g)].map((m) => m[0]);
  expect(cards.length).toBeGreaterThan(0);
  for (const card of cards) {
    expect(card).toMatch(/<div class="case-card-cover">\s*<img src="[^"]+"/);
  }
});

it("a built-in puzzle's lobby-card cover is its own dedicated image, not the shared archive fallback", async () => {
  // pickRandomPuzzle() (mode=existing with no puzzleId) picks from EVERY
  // shared puzzle, including player-authored ones other tests create — not
  // just the eight built-ins — so a specific, known built-in puzzleId is
  // picked explicitly here, same pattern spec/case-file.test.ts uses.
  const picker = await (await fetch(new URL("/rooms/new?mode=existing", baseUrl))).text();
  const puzzleId = picker.match(/<option value="([0-9a-f-]+)">The Elevator Routine/)?.[1];
  expect(puzzleId, "The Elevator Routine should be pickable").toBeTruthy();

  const res = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ mode: "existing", puzzleId: puzzleId! }),
    redirect: "manual",
  });
  const code = (res.headers.get("location") ?? "").split("/").pop() ?? "";
  const html = await (await fetch(new URL("/", baseUrl))).text();
  const card = findCardByCode(html, code);
  expect(card).toContain("/images/mystery/case-elevator.webp");
});

it("a private authored puzzle's room still shows its uploaded cover on the lobby card to an unrelated stranger", async () => {
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp({ create: { width: 400, height: 250, channels: 3, background: { r: 10, g: 80, b: 200 } } })
    .jpeg()
    .toBuffer();
  const title = `Private Lobby Cover Case ${Date.now()}`;
  const form = new FormData();
  form.set("mode", "author");
  form.set("title", title);
  form.set("premise", `${title} premise.`);
  form.set("solution", `${title} solution.`);
  // shared intentionally omitted — this puzzle stays private.
  form.set("cover", new Blob([jpeg], { type: "image/jpeg" }), "cover.jpg");
  const createRes = await fetch(new URL("/rooms", baseUrl), { method: "POST", body: form, redirect: "manual" });
  expect(createRes.status).toBe(303);
  const code = (createRes.headers.get("location") ?? "").split("/").pop() ?? "";

  // A brand-new, unrelated stranger fetch — no cookie forwarded, not the
  // author, hasn't joined this room.
  const home = await (await fetch(new URL("/", baseUrl))).text();
  const card = findCardByCode(home, code);
  const coverMatch = card.match(/\/rooms\/[A-Z0-9]+\/cover/);
  expect(coverMatch, "a private room's lobby card should still carry its own uploaded cover URL").toBeTruthy();

  const coverRes = await fetch(new URL(coverMatch![0], baseUrl));
  expect(coverRes.status, "the room-scoped cover route should serve the image to any viewer").toBe(200);
  expect(coverRes.headers.get("content-type")).toBe("image/webp");

  // The narrower room-cover grant doesn't widen the puzzle-id-keyed route —
  // the lobby card never even carries that URL shape for a private puzzle.
  expect(card.match(/\/uploads\/cover\/[0-9a-f-]+/)).toBeNull();
});

it("a room-scoped cover URL 404s once the room is solved and no longer listed", async () => {
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp({ create: { width: 400, height: 250, channels: 3, background: { r: 5, g: 5, b: 5 } } })
    .jpeg()
    .toBuffer();
  const title = `Solved Lobby Cover Case ${Date.now()}`;
  const solutionText = `The unique solution phrase for ${title}.`;
  const form = new FormData();
  form.set("mode", "author");
  form.set("title", title);
  form.set("premise", `${title} premise.`);
  form.set("solution", solutionText);
  form.set("cover", new Blob([jpeg], { type: "image/jpeg" }), "cover.jpg");
  const createRes = await fetch(new URL("/rooms", baseUrl), { method: "POST", body: form, redirect: "manual" });
  const cookie = parseSessionCookie(createRes.headers.getSetCookie());
  const code = (createRes.headers.get("location") ?? "").split("/").pop() ?? "";

  const coverUrl = new URL(`/rooms/${code}/cover`, baseUrl);
  const before = await fetch(coverUrl);
  expect(before.status).toBe(200);

  await fetch(new URL(`/rooms/${code}/start`, baseUrl), { method: "POST", headers: { cookie }, redirect: "manual" });
  // The author can't guess their own puzzle (notice=author-guess) — join as
  // a second session first, same pattern spec/room-lifecycle.test.ts uses.
  const joinRes = await fetch(new URL(`/rooms/${code}`, baseUrl), { redirect: "manual" });
  const guesserCookie = parseSessionCookie(joinRes.headers.getSetCookie());
  await fetch(new URL(`/rooms/${code}/ask`, baseUrl), {
    method: "POST",
    headers: { cookie: guesserCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ question: solutionText, kind: "guess" }),
    redirect: "manual",
  });

  const after = await fetch(coverUrl);
  expect(after.status, "a solved room's cover URL should 404, same as it drops out of the lobby").toBe(404);
});


it("keeps the original three built-in featured cases after a player publishes a newer story", async () => {
  const marker = `featured-exclusion-${Date.now()}`;
  const result = await fetch(new URL("/rooms", baseUrl), {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ mode: "author", title: "A Bowl of Turtle Soup", premise: marker, solution: "A distinct player-authored explanation.", shared: "on" }),
    redirect: "manual",
  });
  expect(result.status).toBe(303);
  const html = await (await fetch(new URL("/", baseUrl))).text();
  const featured = html.match(/<section class="featured-cases">([\s\S]*?)<\/section>/)?.[1] ?? "";
  expect([...featured.matchAll(/<h3>(.*?)<\/h3>/g)].map(m => m[1])).toEqual([
    "A Bowl of Turtle Soup", "The Silent Phone Call", "The Elevator Routine",
  ]);
  expect(featured).not.toContain(marker);
  expect(featured).toContain("/images/mystery/case-soup.webp");
  expect(featured).toContain("/images/mystery/case-phone.webp");
  expect(featured).toContain("/images/mystery/case-elevator.webp");
  const library = await (await fetch(new URL(`/cases?source=player&q=${marker}`, baseUrl))).text();
  expect(library).toContain(marker);
});
