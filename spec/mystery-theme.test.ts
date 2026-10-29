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
