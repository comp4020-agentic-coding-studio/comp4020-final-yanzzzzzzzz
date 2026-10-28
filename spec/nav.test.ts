import { expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

// The /community-specific aria-current assertion lives in
// spec/community.test.ts instead of here, alongside the rest of that
// route's coverage — this file only asserts against nav items/pages that
// exist independently of whether the community feature itself has landed.
it("the site nav marks the current page with aria-current, has no Login control, and keeps a profile entry point", async () => {
  const home = await (await fetch(new URL("/", baseUrl))).text();
  expect(home).toMatch(/<a href="\/"[^>]*aria-current="page"[^>]*>Home<\/a>/);
  expect(home).toContain("Case Library");
  expect(home).toContain("Community");
  expect(home).not.toMatch(/>\s*Login\s*</);
  expect(home).toMatch(/profile-link/);

  const cases = await (await fetch(new URL("/cases", baseUrl))).text();
  expect(cases).toMatch(/<a href="\/cases"[^>]*aria-current="page"[^>]*>Case Library<\/a>/);
});

it("the brand icon links back to the homepage and is original markup, not an <img> of third-party art", async () => {
  const html = await (await fetch(new URL("/about", baseUrl))).text();
  expect(html).toMatch(/<a class="brand" href="\/">\s*<svg/);
  // No external image reference for the brand mark — everything is inline SVG.
  expect(html).not.toMatch(/<a class="brand"[\s\S]{0,300}<img/);
});
