import { JSDOM } from "jsdom";
import { expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

it("ships a self-hosted OGG audio element and script, with no network preload until the user opts in", async () => {
  const html = await (await fetch(new URL("/", baseUrl))).text();
  expect(html).toMatch(/<audio id="bg-music" src="\/audio\/creepy-ambient\.ogg" loop preload="none">/);
  expect(html).toContain('<script src="/music.js">');

  const audioRes = await fetch(new URL("/audio/creepy-ambient.ogg", baseUrl));
  expect(audioRes.status).toBe(200);
  expect(audioRes.headers.get("content-type")).toContain("audio/ogg");
  // Confirms the served bytes are a genuine Ogg container ("OggS" magic),
  // not an HTML error page or truncated download accidentally committed.
  const bytes = new Uint8Array(await audioRes.arrayBuffer());
  expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("OggS");
  expect(bytes.length).toBeGreaterThan(100_000);
});

it("serves ASSET_LICENSES.md content via /about's music-credits section", async () => {
  const html = await (await fetch(new URL("/about", baseUrl))).text();
  expect(html).toContain("Creepy Ambient Loop");
  expect(html).toContain("epb9000");
  expect(html).toContain("creativecommons.org/publicdomain/zero/1.0");
});

// The music toggle is pure client-side state (localStorage + <audio>), so
// this drives the REAL public/music.js against the REAL rendered layout in
// jsdom, same pattern spec/live-sync.test.ts uses for client.js/lobby.js —
// not a reimplementation of the toggle's logic in test code.
async function loadWithMusicStub(opts: {
  playResolves?: boolean;
  canPlayOgg?: boolean;
  storageThrows?: boolean;
}): Promise<{ window: JSDOM["window"] }> {
  const res = await fetch(new URL("/", baseUrl));
  const html = await res.text();
  const playResolves = opts.playResolves ?? true;
  const canPlayOgg = opts.canPlayOgg ?? true;

  const dom = new JSDOM(html, {
    url: baseUrl,
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    beforeParse(window) {
      // jsdom has no real media decoding; HTMLMediaElement.play()/canPlayType
      // are stubbed here, but every OTHER behavior (the button's aria-pressed
      // flips, status text, localStorage writes) runs through the real,
      // unmodified public/music.js.
      window.HTMLMediaElement.prototype.play = function () {
        return playResolves ? Promise.resolve() : Promise.reject(new DOMException("not allowed", "NotAllowedError"));
      };
      window.HTMLMediaElement.prototype.pause = function () {};
      window.HTMLMediaElement.prototype.canPlayType = () => (canPlayOgg ? "probably" : "");
      if (opts.storageThrows) {
        const throwing = {
          getItem() {
            throw new Error("storage disabled");
          },
          setItem() {
            throw new Error("storage disabled");
          },
        };
        Object.defineProperty(window, "localStorage", { value: throwing });
      }
    },
  });
  await new Promise((resolve) => dom.window.addEventListener("load", resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { window: dom.window };
}

it("music defaults to off with an accurate aria-pressed state and label", async () => {
  const { window } = await loadWithMusicStub({});
  const button = window.document.getElementById("music-toggle")! as HTMLButtonElement;
  expect(button.getAttribute("aria-pressed")).toBe("false");
  expect(button.textContent).toContain("off");
  window.close();
});

it("clicking the toggle plays audio and flips to an accurate on state when play() resolves", async () => {
  const { window } = await loadWithMusicStub({ playResolves: true });
  const button = window.document.getElementById("music-toggle")! as HTMLButtonElement;
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(button.textContent).toContain("on");
  window.close();
});

it("never claims music is on when play() is rejected (autoplay-style restriction), and tells the user", async () => {
  const { window } = await loadWithMusicStub({ playResolves: false });
  const button = window.document.getElementById("music-toggle")! as HTMLButtonElement;
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(button.getAttribute("aria-pressed")).toBe("false");
  expect(button.textContent).toContain("off");
  const status = window.document.getElementById("music-status");
  expect(status?.textContent).toMatch(/click the music button/i);
  window.close();
});

it("disables the toggle and explains itself when the browser can't play OGG at all", async () => {
  const { window } = await loadWithMusicStub({ canPlayOgg: false });
  const button = window.document.getElementById("music-toggle")! as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.getAttribute("aria-pressed")).toBe("false");
  const status = window.document.getElementById("music-status");
  expect(status?.textContent).toMatch(/can't play/i);
  window.close();
});

it("still works (fails safe to off) when localStorage throws instead of crashing the page", async () => {
  const { window } = await loadWithMusicStub({ storageThrows: true, playResolves: true });
  const button = window.document.getElementById("music-toggle")! as HTMLButtonElement;
  expect(button.getAttribute("aria-pressed")).toBe("false");
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  // A storage failure can't block playback itself, only persistence of the
  // preference across reloads — still toggles the button correctly this load.
  expect(button.getAttribute("aria-pressed")).toBe("true");
  window.close();
});
