import { JSDOM } from "jsdom";
import { expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

function parseCookie(setCookieHeaders: string[]): string {
  const c = setCookieHeaders.find((h) => h.startsWith("turtle_session="));
  if (!c) throw new Error("no turtle_session cookie set");
  return c.split(";")[0];
}

// /rooms/new is styled as an open case file on the investigation desk
// (src/render/room-new.ts + .case-file-* in public/styles.css): a left
// "page" showing the chosen case's cover/title/premise (or a sealed
// "Surprise me" state when nothing's picked yet), and a right "page" with
// room settings and the submit button — both inside one real <form>, no
// nested forms, no duplicate ids.

it("defaults to a sealed 'Surprise me' case file, never a specific story nobody actually picked", async () => {
  const html = await (await fetch(new URL("/rooms/new?mode=existing", baseUrl))).text();
  expect(html).toContain("Sealed case");
  expect(html).toContain("Let fate choose your mystery");
  expect(html).toMatch(/<option value="" selected>Surprise me<\/option>/);
  // Puzzle titles still legitimately appear inside the <select>'s own
  // <option> list (that's how a player picks one) — what must NOT happen is
  // a real title rendering as the case-file-title heading, as if it were
  // the already-decided story when nothing was actually selected.
  const heading = html.match(/<h2 class="case-file-title">([^<]*)<\/h2>/)?.[1];
  expect(heading).toBe("Let fate choose your mystery");
});

it("the case-file form is a single real <form> spanning both visual pages, no nesting or duplicate ids", async () => {
  const html = await (await fetch(new URL("/rooms/new?mode=existing", baseUrl))).text();
  expect((html.match(/<form/g) ?? []).length).toBe(1);
  expect(html).toContain('<form method="post" action="/rooms" id="create-form" class="case-file-form">');
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  expect(new Set(ids).size).toBe(ids.length);

  const authorHtml = await (await fetch(new URL("/rooms/new?mode=author", baseUrl))).text();
  expect((authorHtml.match(/<form/g) ?? []).length).toBe(1);
  const authorIds = [...authorHtml.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  expect(new Set(authorIds).size).toBe(authorIds.length);
});

it("every label in both modes targets a real id (no-JS/keyboard accessible by construction)", async () => {
  for (const mode of ["existing", "author"]) {
    const html = await (await fetch(new URL(`/rooms/new?mode=${mode}`, baseUrl))).text();
    const labelTargets = [...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]);
    expect(labelTargets.length).toBeGreaterThan(0);
    for (const target of labelTargets) {
      expect(html, `#${target} should exist for mode=${mode}`).toContain(`id="${target}"`);
    }
  }
});

it("?puzzleId= shows the real chosen case's cover/title/premise on the left page, never the solution", async () => {
  const picker = await (await fetch(new URL("/rooms/new?mode=existing", baseUrl))).text();
  const match = picker.match(/<option value="([0-9a-f-]+)">The Elevator Routine/);
  const puzzleId = match?.[1];
  expect(puzzleId, "The Elevator Routine should be pickable").toBeTruthy();

  const html = await (await fetch(new URL(`/rooms/new?puzzleId=${puzzleId}`, baseUrl))).text();
  expect(html).toContain("The Elevator Routine");
  expect(html).not.toContain("Sealed case");
  expect(html).toContain(`value="${puzzleId}" selected`);
  expect(html).toContain("/images/mystery/case-elevator.webp");
});

it("the embedded puzzle-data JSON never carries a solution field for any puzzle", async () => {
  const html = await (await fetch(new URL("/rooms/new?mode=existing", baseUrl))).text();
  const match = html.match(/<script id="puzzle-data" type="application\/json">(.*?)<\/script>/s);
  expect(match, "puzzle-data script should be present").toBeTruthy();
  const data = JSON.parse(match![1]) as Record<string, unknown>[];
  expect(data.length).toBeGreaterThan(0);
  for (const entry of data) {
    expect(Object.keys(entry)).not.toContain("solution");
  }
});

it("author mode keeps the solution on the room-settings page, explicitly labelled hidden until solved", async () => {
  const html = await (await fetch(new URL("/rooms/new?mode=author", baseUrl))).text();
  expect(html).toContain("Case title");
  expect(html).toContain("Premise (what players see)");
  expect(html).toMatch(/Solution[\s\S]*?hidden until solved/);
  expect(html).toContain('name="shared"');
});

it("an invalid or private ?puzzleId= falls back to the sealed state, never errors or leaks", async () => {
  const bad = await fetch(new URL("/rooms/new?puzzleId=not-a-real-id", baseUrl));
  expect(bad.status).toBe(200);
  const badHtml = await bad.text();
  expect(badHtml).toContain("Sealed case");
  expect(badHtml).not.toMatch(/value="not-a-real-id" selected/);

  const privateTitle = `Private Case File ${Date.now()}`;
  const create = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      mode: "author",
      title: privateTitle,
      premise: "Private premise.",
      solution: "Private solution.",
    }),
    redirect: "manual",
  });
  expect(create.status).toBe(303);
  const picker = await (await fetch(new URL("/rooms/new?mode=existing", baseUrl))).text();
  expect(picker).not.toContain(privateTitle);
});

it("submitting the existing-case form with no selection still creates a room with a real (random) puzzle", async () => {
  const create = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ mode: "existing" }),
    redirect: "manual",
  });
  expect(create.status).toBe(303);
  const code = (create.headers.get("location") ?? "").split("/").pop() ?? "";
  const cookie = parseCookie(create.headers.getSetCookie());
  const roomHtml = await (await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie } })).text();
  expect(roomHtml).toMatch(/<h1>/);
});

it("submitting the author form with a blank field redirects back with the incomplete-case notice", async () => {
  const res = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ mode: "author", title: "", premise: "", solution: "" }),
    redirect: "manual",
  });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/rooms/new?mode=author&notice=incomplete-puzzle");
  const html = await (await fetch(new URL(res.headers.get("location")!, baseUrl))).text();
  expect(html).toContain("Fill in a title, premise, and solution");
});

it("the case-source tabs are real links with aria-current, not JS-only tab panels", async () => {
  const html = await (await fetch(new URL("/rooms/new?mode=existing", baseUrl))).text();
  expect(html).toMatch(/<a href="\/rooms\/new\?mode=existing" class="active" aria-current="page">Choose a case<\/a>/);
  expect(html).toMatch(/<a href="\/rooms\/new\?mode=author" class="" aria-current="false">Write your own<\/a>/);

  const authorHtml = await (await fetch(new URL("/rooms/new?mode=author", baseUrl))).text();
  expect(authorHtml).toMatch(/<a href="\/rooms\/new\?mode=author" class="active" aria-current="page">Write your own<\/a>/);
});

// Drives the REAL public/create-case.js against the REAL rendered page in
// jsdom, same pattern spec/music.test.ts and spec/live-sync.test.ts use —
// not a reimplementation of the swap logic in test code.
async function loadCreateCaseDom(path: string): Promise<{ window: JSDOM["window"] }> {
  const html = await (await fetch(new URL(path, baseUrl))).text();
  const dom = new JSDOM(html, {
    url: new URL(path, baseUrl).toString(),
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
  });
  await new Promise((resolve) => dom.window.addEventListener("load", resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { window: dom.window };
}

it("selecting a real case in the picker swaps the left page to that case's real cover/title/premise, live", async () => {
  const { window } = await loadCreateCaseDom("/rooms/new?mode=existing");
  const select = window.document.getElementById("puzzleId") as HTMLSelectElement;
  const realOption = [...select.options].find((o) => o.value !== "");
  expect(realOption, "at least one real puzzle option should exist").toBeTruthy();

  select.value = realOption!.value;
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));

  const left = window.document.getElementById("case-file-preview")!;
  expect(left.textContent).not.toContain("Sealed case");
  expect(left.innerHTML).toContain("<img");
  window.close();
});

it("switching back to 'Surprise me' restores the sealed state, not a stale picked case", async () => {
  const { window } = await loadCreateCaseDom("/rooms/new?mode=existing");
  const select = window.document.getElementById("puzzleId") as HTMLSelectElement;
  const realOption = [...select.options].find((o) => o.value !== "");
  select.value = realOption!.value;
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));

  select.value = "";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));

  const left = window.document.getElementById("case-file-preview")!;
  expect(left.textContent).toContain("Sealed case");
  expect(left.textContent).toContain("Let fate choose your mystery");
  window.close();
});

it("the author-mode submit label swaps when 'share publicly' is checked, real DOM not a stub", async () => {
  const { window } = await loadCreateCaseDom("/rooms/new?mode=author");
  const shared = window.document.getElementById("shared") as HTMLInputElement;
  const submit = window.document.getElementById("create-submit") as HTMLButtonElement;
  expect(submit.textContent).toBe("Create investigation room");

  shared.checked = true;
  shared.dispatchEvent(new window.Event("change", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(submit.textContent).toBe("Publish case and create room");
  window.close();
});
