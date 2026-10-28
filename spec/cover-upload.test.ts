import { expect, inject, it } from "vitest";
import sharp from "sharp";

// Exercises the real multipart upload path end to end against the running
// app (src/uploads.ts + routes/rooms.ts's POST /rooms + GET
// /uploads/cover/:puzzleId) — not a reimplementation of sharp's own decode
// logic in test code. Fixture images are generated on the fly with the same
// sharp dependency the app itself uses, rather than committing binary test
// fixtures to the repo.
const baseUrl = inject("baseUrl");

function parseCookie(setCookieHeaders: string[]): string {
  const sessionCookie = setCookieHeaders.find((h) => h.startsWith("turtle_session="));
  if (!sessionCookie) throw new Error("no turtle_session cookie set");
  return sessionCookie.split(";")[0];
}

function requireCookie(cookie: string | null): string {
  if (!cookie) throw new Error("expected this path to set a session cookie, but none was set");
  return cookie;
}

// Buffer/Node's Uint8Array type as returned by sharp (and Buffer.alloc)
// carries a `buffer: ArrayBufferLike` that TS's DOM lib won't accept as a
// BlobPart (it wants a concrete ArrayBuffer) — copying into a fresh
// Uint8Array<ArrayBuffer> is a real, harmless copy (these are small test
// fixtures), not a cast papering over an actual runtime mismatch.
function toBlobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(bytes);
}

async function makeJpeg(width = 400, height = 250): Promise<Uint8Array<ArrayBuffer>> {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 60, b: 60 } } })
    .jpeg()
    .toBuffer();
  return toBlobPart(buf);
}

async function createRoomWithCover(args: {
  title: string;
  shared?: boolean;
  cover?: { bytes: BlobPart; filename: string; type: string };
}): Promise<{ status: number; location: string; cookie: string | null }> {
  const form = new FormData();
  form.set("mode", "author");
  form.set("title", args.title);
  form.set("premise", `${args.title} premise.`);
  form.set("solution", `${args.title} solution.`);
  if (args.shared) form.set("shared", "on");
  if (args.cover) {
    const blob = new Blob([args.cover.bytes], { type: args.cover.type });
    form.set("cover", blob, args.cover.filename);
  }
  const res = await fetch(new URL("/rooms", baseUrl), { method: "POST", body: form, redirect: "manual" });
  // The body-limit middleware's own onError (hono/body-limit) rejects a
  // too-large request BEFORE the route handler — and therefore before
  // getOrCreateSessionId() — ever runs, so that one path never sets a
  // session cookie at all. Every other path does. Callers that need the
  // cookie (anything checking per-author access) use a cover small enough
  // to pass the body-limit check in the first place.
  const setCookie = res.headers.getSetCookie();
  const cookie = setCookie.length > 0 ? parseCookie(setCookie) : null;
  return { status: res.status, location: res.headers.get("location") ?? "", cookie };
}

it("a valid JPEG cover upload creates a working room, and the cover is served as real image/webp", async () => {
  const title = `Cover JPEG Case ${Date.now()}`;
  const jpeg = await makeJpeg();
  const { status, location, cookie } = await createRoomWithCover({
    title,
    shared: true,
    cover: { bytes: jpeg, filename: "cover.jpg", type: "image/jpeg" },
  });
  expect(status).toBe(303);
  const code = location.split("/").pop() ?? "";

  const roomHtml = await (
    await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie: requireCookie(cookie) } })
  ).text();
  const coverMatch = roomHtml.match(/\/uploads\/cover\/[0-9a-f-]+/);
  expect(coverMatch, "room page should show an uploaded-cover <img> src").toBeTruthy();

  const coverRes = await fetch(new URL(coverMatch![0], baseUrl));
  expect(coverRes.status).toBe(200);
  expect(coverRes.headers.get("content-type")).toBe("image/webp");
  expect(coverRes.headers.get("x-content-type-options")).toBe("nosniff");
  const bytes = new Uint8Array(await coverRes.arrayBuffer());
  // RIFF....WEBP — the real file signature, not just a trusted header.
  const signature = Buffer.from(bytes.slice(0, 12)).toString("latin1");
  expect(signature.startsWith("RIFF")).toBe(true);
  expect(signature.includes("WEBP")).toBe(true);
});

it("a PNG cover is also accepted and re-encoded to WebP", async () => {
  const title = `Cover PNG Case ${Date.now()}`;
  const png = toBlobPart(
    await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 200, b: 0, alpha: 1 } } })
      .png()
      .toBuffer(),
  );
  const { status, location, cookie } = await createRoomWithCover({
    title,
    shared: true,
    cover: { bytes: png, filename: "cover.png", type: "image/png" },
  });
  expect(status).toBe(303);
  const code = location.split("/").pop() ?? "";
  const roomHtml = await (
    await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie: requireCookie(cookie) } })
  ).text();
  expect(roomHtml).toMatch(/\/uploads\/cover\/[0-9a-f-]+/);
});

it("no file chosen falls back to the existing archive cover, not a blank image", async () => {
  const title = `No Cover Case ${Date.now()}`;
  const { status, location, cookie } = await createRoomWithCover({ title, shared: true });
  expect(status).toBe(303);
  const code = location.split("/").pop() ?? "";
  const roomHtml = await (
    await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie: requireCookie(cookie) } })
  ).text();
  expect(roomHtml).not.toMatch(/\/uploads\/cover\//);
  expect(roomHtml).toMatch(/\/images\/mystery\/case-archive\.webp/);
});

it("a corrupt/fake-MIME file is rejected with a clear notice, not a 500 or a silent success", async () => {
  const title = `Corrupt Case ${Date.now()}`;
  const fakeBytes = new TextEncoder().encode("definitely not an image".repeat(10));
  const { status, location } = await createRoomWithCover({
    title,
    cover: { bytes: fakeBytes, filename: "fake.png", type: "image/png" },
  });
  expect(status).toBe(303);
  expect(location).toContain("notice=corrupt");
  const html = await (await fetch(new URL(location, baseUrl))).text();
  expect(html).toMatch(/couldn't be read/);
});

it("an SVG upload is rejected as an unsupported format, never decoded as a cover", async () => {
  const title = `SVG Case ${Date.now()}`;
  const svg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
  );
  const { status, location } = await createRoomWithCover({
    title,
    cover: { bytes: svg, filename: "x.svg", type: "image/svg+xml" },
  });
  expect(status).toBe(303);
  expect(location).toContain("notice=unsupported-format");
});

it("a GIF upload is rejected as an unsupported format", async () => {
  const title = `GIF Case ${Date.now()}`;
  const gif = toBlobPart(
    await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 255, b: 0 } } })
      .gif()
      .toBuffer(),
  );
  const { status, location } = await createRoomWithCover({
    title,
    cover: { bytes: gif, filename: "x.gif", type: "image/gif" },
  });
  expect(status).toBe(303);
  expect(location).toContain("notice=unsupported-format");
});

it("a file over the 2 MiB per-file limit is rejected before any decode is attempted", async () => {
  const title = `Too Large Case ${Date.now()}`;
  const big = new Uint8Array(2.5 * 1024 * 1024).fill(7);
  const { status, location } = await createRoomWithCover({
    title,
    cover: { bytes: big, filename: "big.jpg", type: "image/jpeg" },
  });
  expect(status).toBe(303);
  expect(location).toContain("notice=too-large");
});

it("an image whose real pixel count exceeds the decode limit is rejected, not decoded in full", async () => {
  const title = `Pixel Limit Case ${Date.now()}`;
  // 5000x5000 = 25 megapixels > the 16-megapixel limit, kept well under the
  // 2 MiB file-size limit via heavy JPEG compression, so this exercises the
  // PIXEL limit specifically, not the file-size limit.
  const oversized = toBlobPart(
    await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg({ quality: 15 })
      .toBuffer(),
  );
  expect(oversized.length).toBeLessThan(2 * 1024 * 1024);
  const { status, location } = await createRoomWithCover({
    title,
    cover: { bytes: oversized, filename: "huge.jpg", type: "image/jpeg" },
  });
  expect(status).toBe(303);
  expect(location).toContain("notice=pixel-limit");
});

it("an oversized total request body is rejected by the body-size limit before multipart parsing runs", async () => {
  const title = `Body Limit Case ${Date.now()}`;
  const big = new Uint8Array(3.5 * 1024 * 1024).fill(3);
  const { status, location } = await createRoomWithCover({
    title,
    cover: { bytes: big, filename: "huge.jpg", type: "image/jpeg" },
  });
  expect(status).toBe(303);
  expect(location).toContain("notice=cover-too-large");
});

it("an incomplete submission (no title) never creates an orphaned cover file — validated before any file processing", async () => {
  const jpeg = await makeJpeg();
  const form = new FormData();
  form.set("mode", "author");
  form.set("title", "");
  form.set("premise", "premise");
  form.set("solution", "solution");
  form.set("cover", new Blob([jpeg], { type: "image/jpeg" }), "cover.jpg");
  const res = await fetch(new URL("/rooms", baseUrl), { method: "POST", body: form, redirect: "manual" });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toContain("notice=incomplete-puzzle");
});

it("a private (unshared) puzzle's cover is visible to its author but not to an unrelated stranger session", async () => {
  const title = `Private Cover Case ${Date.now()}`;
  const jpeg = await makeJpeg();
  const { status, location, cookie: authorCookieOrNull } = await createRoomWithCover({
    title,
    cover: { bytes: jpeg, filename: "cover.jpg", type: "image/jpeg" },
  });
  const authorCookie = requireCookie(authorCookieOrNull);
  expect(status).toBe(303);
  const code = location.split("/").pop() ?? "";
  const roomHtml = await (
    await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie: authorCookie } })
  ).text();
  const coverUrl = roomHtml.match(/\/uploads\/cover\/[0-9a-f-]+/)?.[0];
  expect(coverUrl, "private room should still show its own cover to its author").toBeTruthy();

  const authorRes = await fetch(new URL(coverUrl!, baseUrl), { headers: { cookie: authorCookie } });
  expect(authorRes.status).toBe(200);

  // No cookie at all = a brand-new anonymous session that never joined this
  // room and isn't the author — must not be able to view a private cover by
  // guessing/reusing the puzzle id from the URL.
  const strangerRes = await fetch(new URL(coverUrl!, baseUrl));
  expect(strangerRes.status).toBe(404);
});

it("a shared (public) puzzle's cover is visible to anyone, cookie or not", async () => {
  const title = `Public Cover Case ${Date.now()}`;
  const jpeg = await makeJpeg();
  const { status, location } = await createRoomWithCover({
    title,
    shared: true,
    cover: { bytes: jpeg, filename: "cover.jpg", type: "image/jpeg" },
  });
  expect(status).toBe(303);
  const code = location.split("/").pop() ?? "";
  const roomHtml = await (await fetch(new URL(`/rooms/${code}`, baseUrl))).text();
  const coverUrl = roomHtml.match(/\/uploads\/cover\/[0-9a-f-]+/)?.[0];
  expect(coverUrl).toBeTruthy();

  const strangerRes = await fetch(new URL(coverUrl!, baseUrl));
  expect(strangerRes.status).toBe(200);
  expect(strangerRes.headers.get("content-type")).toBe("image/webp");
});

it("an uploaded cover also appears in the case library and the room-creation picker preview, not just the room page", async () => {
  const title = `Library Cover Case ${Date.now()}`;
  const jpeg = await makeJpeg();
  const { status, location } = await createRoomWithCover({
    title,
    shared: true,
    cover: { bytes: jpeg, filename: "cover.jpg", type: "image/jpeg" },
  });
  expect(status).toBe(303);

  const casesHtml = await (await fetch(new URL("/cases", baseUrl))).text();
  expect(casesHtml).toContain(title);
  // The case-library card for this exact title should use the uploaded
  // cover's URL, not the shared archive fallback — checked by finding the
  // <li> containing this title and asserting it also contains an
  // /uploads/cover/ src within the same card, not merely somewhere on the
  // page (another card could legitimately have no cover at all).
  const cardIndex = casesHtml.indexOf(title);
  const cardStart = casesHtml.lastIndexOf("<li class=\"case-browse-card\">", cardIndex);
  const cardEnd = casesHtml.indexOf("</li>", cardIndex);
  const card = casesHtml.slice(cardStart, cardEnd);
  expect(card).toMatch(/\/uploads\/cover\/[0-9a-f-]+/);

  // The room-creation picker's embedded puzzle-data JSON (used for the
  // live preview swap, public/create-case.js) should also resolve this
  // puzzle's coverUrl to the uploaded cover, not a fallback.
  const pickerHtml = await (await fetch(new URL("/rooms/new?mode=existing", baseUrl))).text();
  const match = pickerHtml.match(/<script id="puzzle-data" type="application\/json">(.*?)<\/script>/s);
  expect(match).toBeTruthy();
  const data = JSON.parse(match![1]) as { title: string; coverUrl: string }[];
  const entry = data.find((p) => p.title === title);
  expect(entry, "uploaded-cover puzzle should appear in the picker's data").toBeTruthy();
  expect(entry!.coverUrl).toMatch(/\/uploads\/cover\/[0-9a-f-]+/);
});
