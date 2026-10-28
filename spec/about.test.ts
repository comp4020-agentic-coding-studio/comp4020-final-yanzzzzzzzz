import { expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

// /about replaces the old /readme/ link in the site nav as a short,
// player-facing page — it must not restate the long technical README (stack,
// CI, Fly, database, the course brief) inline, only link to it.
it("serves a short player-facing /about page, distinct from the technical /readme/", async () => {
  const res = await fetch(new URL("/about", baseUrl));
  expect(res.status).toBe(200);
  const html = await res.text();

  expect(html).toContain("About Turtle Soup");
  expect(html).toContain("Start a new case");
  expect(html).toContain("Back to lobby");
  expect(html).toContain("horror or graphic content");
  // Links to the technical doc rather than inlining it.
  expect(html).toContain('href="/readme/"');

  for (const devDetail of ["SQLite", "Fly.io", "fly.toml", "GROQ", "Dockerfile", "PROCESS.md", "/data"]) {
    expect(html, `/about should not mention "${devDetail}"`).not.toContain(devDetail);
  }
});

it("still points the site nav's About link at /about, not /readme/", async () => {
  const res = await fetch(new URL("/", baseUrl));
  const html = await res.text();
  expect(html).toMatch(/<nav class="site-nav">\s*<a href="\/about">About<\/a>/);
});

it("/readme/ is still served and still passes the invariant (technical docs, not removed)", async () => {
  const res = await fetch(new URL("/readme/", baseUrl));
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("<title>Technical documentation");
});
