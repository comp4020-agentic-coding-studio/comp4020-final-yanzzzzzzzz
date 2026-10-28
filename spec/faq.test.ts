import { JSDOM } from "jsdom";
import { expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

it("every FAQ item is its own independently-collapsible <details>, collapsed by default", async () => {
  const html = await (await fetch(new URL("/", baseUrl))).text();
  const items = [...html.matchAll(/<details class="faq-item">[\s\S]*?<\/details>/g)];
  expect(items.length).toBeGreaterThanOrEqual(5);
  for (const [block] of items) {
    expect(block).not.toContain(" open");
    expect(block).toMatch(/<summary>[^<]+<\/summary>/);
  }
  // All the original FAQ question text is still present — the collapsible
  // rework didn't drop or reword any existing answer.
  expect(html).toContain("Is there a limit on how many questions I can ask?");
  expect(html).toContain("Is there a single correct answer?");
  expect(html).toContain("Do I need an account?");
  expect(html).toContain("Can I play alone?");
  expect(html).toContain("What happens when someone solves it?");
});

// <details>/<summary> toggling is native browser behavior with no JS
// involved at all — this drives the real rendered markup through jsdom
// (which implements the native open/click/keyboard behavior) to confirm the
// feature works with scripts entirely off, not just that the HTML looks
// right.
async function loadHomeDom(): Promise<JSDOM> {
  const html = await (await fetch(new URL("/", baseUrl))).text();
  return new JSDOM(html, { url: baseUrl, pretendToBeVisual: true });
}

it("each FAQ item opens/closes independently via its native <details> toggle, with no JS required", async () => {
  const dom = await loadHomeDom();
  const items = dom.window.document.querySelectorAll(".faq-item");
  expect(items.length).toBeGreaterThanOrEqual(5);

  const first = items[0] as HTMLDetailsElement;
  const second = items[1] as HTMLDetailsElement;
  expect(first.open).toBe(false);
  expect(second.open).toBe(false);

  first.querySelector("summary")!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  // jsdom's <details> toggles its [open] attribute synchronously on a real
  // click at the <summary>, the same native behavior a mouse/Enter/Space
  // activation triggers in a real browser.
  expect(first.open).toBe(true);
  expect(second.open).toBe(false); // opening one never force-closes another

  second.querySelector("summary")!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  expect(first.open).toBe(true);
  expect(second.open).toBe(true); // multiple items can be open at once
});

it("a FAQ summary is keyboard-focusable and the stylesheet gives it a visible focus style", async () => {
  const html = await (await fetch(new URL("/", baseUrl))).text();
  // The summary element itself needs no tabindex to be keyboard-reachable —
  // <summary> is natively focusable — so this confirms no tabindex="-1" (or
  // similar) was added that would opt it out of the default tab order.
  expect(html).not.toMatch(/<summary[^>]*tabindex="-1"/);

  const css = await (await fetch(new URL("/styles.css", baseUrl))).text();
  expect(css).toMatch(/\.faq-item summary:focus-visible\s*\{[^}]*outline/);
});
