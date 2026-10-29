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
  expect(html).toContain("Read the scene");
  expect(html).toContain("Solve together");
  expect(html).toContain("horror or graphic content");

  for (const devDetail of ["SQLite", "Fly.io", "fly.toml", "Gemini", "Dockerfile", "PROCESS.md", "/data"]) {
    expect(html, `/about should not mention "${devDetail}"`).not.toContain(devDetail);
  }
});

it("links to /about from the site footer, not the main nav", async () => {
  const res = await fetch(new URL("/", baseUrl));
  const html = await res.text();
  expect(html).toMatch(/<footer class="site-footer">[\s\S]*<a href="\/about">About<\/a>/);
});

it("/readme/ is still served and still passes the invariant (technical docs, not removed)", async () => {
  const res = await fetch(new URL("/readme/", baseUrl));
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("<title>Technical documentation");
});
