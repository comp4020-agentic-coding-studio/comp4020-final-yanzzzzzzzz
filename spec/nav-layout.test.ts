import { expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

it("groups the brand and nav together on the left, separate from the right-aligned controls", async () => {
  const html = await (await fetch(new URL("/", baseUrl))).text();
  // The brand and nav live inside one shared wrapper...
  expect(html).toMatch(
    /<div class="site-header-left">\s*<a class="brand"[\s\S]*?<nav class="site-nav"[\s\S]*?<\/nav>\s*<\/div>/,
  );
  // ...and .site-controls (music toggle + profile link) is a sibling of that
  // wrapper, not nested inside the same left group.
  const leftGroupEnd = html.indexOf("</div>", html.indexOf('class="site-header-left"'));
  const controlsStart = html.indexOf('class="site-controls"');
  expect(controlsStart).toBeGreaterThan(leftGroupEnd);
});

it("the stylesheet pushes .site-controls right with margin-left: auto, not a three-way space-between", async () => {
  const css = await (await fetch(new URL("/styles.css", baseUrl))).text();
  expect(css).toMatch(/\.site-controls\s*\{[^}]*margin-left:\s*auto/);
  // The header itself no longer relies on justify-content: space-between to
  // position its children — that would spread three flex items (brand, nav,
  // controls) evenly and land the nav in the middle instead of attached to
  // the brand on the left.
  const headerRule = css.match(/\.site-header\s*\{[^}]*\}/)?.[0] ?? "";
  expect(headerRule).not.toMatch(/justify-content:\s*space-between/);
});
