import { expect, inject, it } from "vitest";
import sharp from "sharp";

const baseUrl = inject("baseUrl");

async function makeAvatarJpeg(color: { r: number; g: number; b: number }): Promise<Uint8Array<ArrayBuffer>> {
  const buf = await sharp({ create: { width: 300, height: 300, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
  return Uint8Array.from(buf);
}

function parseCookie(setCookieHeaders: string[]): string {
  const sessionCookie = setCookieHeaders.find((h) => h.startsWith("turtle_session="));
  if (!sessionCookie) throw new Error("no turtle_session cookie set");
  return sessionCookie.split(";")[0];
}

it("a chosen nickname and avatar replace the auto-label in a new room, and persist on the profile page", async () => {
  const first = await fetch(new URL("/", baseUrl), { redirect: "manual" });
  const cookie = parseCookie(first.headers.getSetCookie());

  const save = await fetch(new URL("/profile", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ nickname: "Riko", avatar: "🐢", bio: "likes soup" }),
    redirect: "manual",
  });
  expect(save.status).toBe(303);

  const profilePage = await fetch(new URL("/profile", baseUrl), { headers: { cookie } });
  const profileHtml = await profilePage.text();
  expect(profileHtml).toContain('value="Riko"');
  expect(profileHtml).toContain("likes soup");

  const createRoom = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { cookie },
    redirect: "manual",
  });
  const code = (createRoom.headers.get("location") ?? "").split("/").pop();

  const roomHtml = await (await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie } })).text();
  expect(roomHtml).toContain("🐢 Riko");
  expect(roomHtml).not.toContain("Mystery Detective #1");
});

it("rejects an avatar outside the fixed set rather than storing arbitrary text", async () => {
  const first = await fetch(new URL("/", baseUrl), { redirect: "manual" });
  const cookie = parseCookie(first.headers.getSetCookie());

  await fetch(new URL("/profile", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ nickname: "Casey", avatar: "<script>evil</script>" }),
    redirect: "manual",
  });

  const html = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie } })).text();
  expect(html).not.toContain("<script>evil</script>");
});

// ---------- Avatar image upload (src/uploads.ts's processAvatarUpload,
// routes/profile.ts's POST /profile/avatar) ----------

it("uploading a real avatar image makes it the player's avatar, served as real image/webp, and takes priority over an emoji", async () => {
  const first = await fetch(new URL("/", baseUrl), { redirect: "manual" });
  const cookie = parseCookie(first.headers.getSetCookie());

  // Set an emoji avatar first — the uploaded image should take priority
  // over it once uploaded, without the emoji selection being lost from the
  // DB (src/db.ts's setProfile() is never called by the upload route).
  await fetch(new URL("/profile", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ nickname: "Casey", avatar: "🐢" }),
    redirect: "manual",
  });

  const jpeg = await makeAvatarJpeg({ r: 200, g: 60, b: 60 });
  const form = new FormData();
  form.set("avatarFile", new Blob([jpeg], { type: "image/jpeg" }), "me.jpg");
  const upload = await fetch(new URL("/profile/avatar", baseUrl), {
    method: "POST",
    headers: { cookie },
    body: form,
    redirect: "manual",
  });
  expect(upload.status).toBe(303);
  expect(upload.headers.get("location")).toBe("/profile?saved=1");

  const profileHtml = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie } })).text();
  const avatarMatch = profileHtml.match(/\/uploads\/avatar\/[0-9a-f-]+\.webp/);
  expect(avatarMatch, "profile page should show the uploaded avatar's URL").toBeTruthy();
  // The emoji radio is still saved underneath (never silently cleared by
  // the upload), but the uploaded image is what actually renders as the
  // current avatar preview.
  expect(profileHtml).toContain('value="🐢" checked');

  const imgRes = await fetch(new URL(avatarMatch![0], baseUrl));
  expect(imgRes.status).toBe(200);
  expect(imgRes.headers.get("content-type")).toBe("image/webp");
  expect(imgRes.headers.get("x-content-type-options")).toBe("nosniff");
  const bytes = new Uint8Array(await imgRes.arrayBuffer());
  const signature = Buffer.from(bytes.slice(0, 12)).toString("latin1");
  expect(signature.startsWith("RIFF")).toBe(true);
  expect(signature.includes("WEBP")).toBe(true);
});

it("removing an uploaded avatar restores the emoji/preset fallback, and a stale URL 404s afterward", async () => {
  const first = await fetch(new URL("/", baseUrl), { redirect: "manual" });
  const cookie = parseCookie(first.headers.getSetCookie());

  const jpeg = await makeAvatarJpeg({ r: 10, g: 150, b: 10 });
  const form = new FormData();
  form.set("avatarFile", new Blob([jpeg], { type: "image/jpeg" }), "me.jpg");
  await fetch(new URL("/profile/avatar", baseUrl), { method: "POST", headers: { cookie }, body: form });

  const before = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie } })).text();
  const avatarUrl = before.match(/\/uploads\/avatar\/[0-9a-f-]+\.webp/)?.[0];
  expect(avatarUrl).toBeTruthy();

  const remove = await fetch(new URL("/profile/avatar/remove", baseUrl), {
    method: "POST",
    headers: { cookie },
    redirect: "manual",
  });
  expect(remove.status).toBe(303);

  const after = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie } })).text();
  expect(after).not.toContain(avatarUrl!);

  const staleRes = await fetch(new URL(avatarUrl!, baseUrl));
  expect(staleRes.status).toBe(404);
});

// Real Chromium submits an untouched <input type="file"> as a File with
// name "" and size 0, not a missing field (same shape as the cover-upload
// regression spec/cover-upload.test.ts covers) — the avatar route must
// treat this as "no file chosen," never as a corrupt-upload rejection, and
// must never clear an avatar the player already has.
it("a real browser's empty file-input sentinel for avatar upload is a no-op, never a rejection or a silent clear", async () => {
  const first = await fetch(new URL("/", baseUrl), { redirect: "manual" });
  const cookie = parseCookie(first.headers.getSetCookie());

  const jpeg = await makeAvatarJpeg({ r: 50, g: 50, b: 200 });
  const form = new FormData();
  form.set("avatarFile", new Blob([jpeg], { type: "image/jpeg" }), "me.jpg");
  await fetch(new URL("/profile/avatar", baseUrl), { method: "POST", headers: { cookie }, body: form });
  const before = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie } })).text();
  const avatarUrl = before.match(/\/uploads\/avatar\/[0-9a-f-]+\.webp/)?.[0];
  expect(avatarUrl).toBeTruthy();

  const boundary = "----avatarEmptySentinelBoundary";
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="avatarFile"; filename=""\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n\r\n` +
    `--${boundary}--\r\n`;
  const res = await fetch(new URL("/profile/avatar", baseUrl), {
    method: "POST",
    headers: { cookie, "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
    redirect: "manual",
  });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).not.toContain("notice=");

  const after = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie } })).text();
  expect(after).toContain(avatarUrl!);
});

it("a corrupt avatar upload is rejected with a clear notice, and never clears an existing avatar", async () => {
  const first = await fetch(new URL("/", baseUrl), { redirect: "manual" });
  const cookie = parseCookie(first.headers.getSetCookie());

  const jpeg = await makeAvatarJpeg({ r: 90, g: 90, b: 90 });
  const goodForm = new FormData();
  goodForm.set("avatarFile", new Blob([jpeg], { type: "image/jpeg" }), "me.jpg");
  await fetch(new URL("/profile/avatar", baseUrl), { method: "POST", headers: { cookie }, body: goodForm });
  const before = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie } })).text();
  const avatarUrl = before.match(/\/uploads\/avatar\/[0-9a-f-]+\.webp/)?.[0];

  const fakeBytes = new TextEncoder().encode("definitely not an image".repeat(10));
  const badForm = new FormData();
  badForm.set("avatarFile", new Blob([fakeBytes], { type: "image/png" }), "fake.png");
  const res = await fetch(new URL("/profile/avatar", baseUrl), {
    method: "POST",
    headers: { cookie },
    body: badForm,
    redirect: "manual",
  });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toContain("notice=corrupt");

  const after = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie } })).text();
  expect(after, "a rejected avatar upload must not silently clear the existing one").toContain(avatarUrl!);
});

// A real, reproduced bug: sharp's metadata() only reads a file's HEADER — it
// succeeds on a JPEG whose pixel data was cut off partway through, since the
// header alone is still intact. The actual decode only happens later inside
// resize()/toBuffer(), which (before the uploads.ts fix) had no try/catch of
// its own and let that failure escape as an uncaught 500 rather than the
// same "corrupt" rejection a fully-unreadable file already gets. Built from
// a real deterministic pixel pattern (not noise), truncated to 70% of its
// own encoded length — past the header, partway through real scan data.
async function makeTruncatedAvatarJpeg(ratio: number): Promise<Uint8Array<ArrayBuffer>> {
  const width = 128;
  const height = 128;
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 73 + Math.floor(i / 127) * 131) % 256;
  const full = await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  return Uint8Array.from(full.subarray(0, Math.floor(full.length * ratio)));
}

it("an avatar JPEG with a valid header but truncated pixel data is rejected as corrupt, not a 500, and never clears an existing avatar", async () => {
  const first = await fetch(new URL("/", baseUrl), { redirect: "manual" });
  const cookie = parseCookie(first.headers.getSetCookie());

  const jpeg = await makeAvatarJpeg({ r: 70, g: 70, b: 180 });
  const goodForm = new FormData();
  goodForm.set("avatarFile", new Blob([jpeg], { type: "image/jpeg" }), "me.jpg");
  await fetch(new URL("/profile/avatar", baseUrl), { method: "POST", headers: { cookie }, body: goodForm });
  const before = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie } })).text();
  const avatarUrl = before.match(/\/uploads\/avatar\/[0-9a-f-]+\.webp/)?.[0];
  expect(avatarUrl).toBeTruthy();

  const truncated = await makeTruncatedAvatarJpeg(0.7);
  const badForm = new FormData();
  badForm.set("avatarFile", new Blob([truncated], { type: "image/jpeg" }), "truncated.jpg");
  const res = await fetch(new URL("/profile/avatar", baseUrl), {
    method: "POST",
    headers: { cookie },
    body: badForm,
    redirect: "manual",
  });
  expect(res.status, "a decode failure must redirect with a notice, never crash as a 500").toBe(303);
  expect(res.headers.get("location")).toContain("notice=corrupt");

  const after = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie } })).text();
  expect(after, "a rejected truncated avatar upload must not clear the existing one").toContain(avatarUrl!);
});

it("saving a plain nickname/bio change never clears a previously uploaded avatar", async () => {
  const first = await fetch(new URL("/", baseUrl), { redirect: "manual" });
  const cookie = parseCookie(first.headers.getSetCookie());

  const jpeg = await makeAvatarJpeg({ r: 220, g: 180, b: 20 });
  const form = new FormData();
  form.set("avatarFile", new Blob([jpeg], { type: "image/jpeg" }), "me.jpg");
  await fetch(new URL("/profile/avatar", baseUrl), { method: "POST", headers: { cookie }, body: form });
  const before = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie } })).text();
  const avatarUrl = before.match(/\/uploads\/avatar\/[0-9a-f-]+\.webp/)?.[0];
  expect(avatarUrl).toBeTruthy();

  await fetch(new URL("/profile", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ nickname: "Jordan", bio: "new bio", avatar: "" }),
    redirect: "manual",
  });

  const after = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie } })).text();
  expect(after).toContain('value="Jordan"');
  expect(after).toContain(avatarUrl!);
});

it("two different sessions each see their own uploaded avatar beside their own messages in a shared room", async () => {
  const hostRes = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      mode: "author",
      title: `Two Avatar Case ${Date.now()}`,
      premise: "premise",
      solution: "solution",
    }),
    redirect: "manual",
  });
  const code = (hostRes.headers.get("location") ?? "").split("/").pop() ?? "";
  const hostCookie = parseCookie(hostRes.headers.getSetCookie());
  await fetch(new URL(`/rooms/${code}/start`, baseUrl), {
    method: "POST",
    headers: { cookie: hostCookie },
    redirect: "manual",
  });

  const hostJpeg = await makeAvatarJpeg({ r: 255, g: 0, b: 0 });
  const hostForm = new FormData();
  hostForm.set("avatarFile", new Blob([hostJpeg], { type: "image/jpeg" }), "host.jpg");
  await fetch(new URL("/profile/avatar", baseUrl), { method: "POST", headers: { cookie: hostCookie }, body: hostForm });
  const hostProfile = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie: hostCookie } })).text();
  const hostAvatarUrl = hostProfile.match(/\/uploads\/avatar\/[0-9a-f-]+\.webp/)?.[0];
  expect(hostAvatarUrl).toBeTruthy();

  // A second, unrelated session joins the same room with its own avatar.
  const joinRes = await fetch(new URL(`/rooms/${code}`, baseUrl), { redirect: "manual" });
  const guestCookie = parseCookie(joinRes.headers.getSetCookie());
  const guestJpeg = await makeAvatarJpeg({ r: 0, g: 0, b: 255 });
  const guestForm = new FormData();
  guestForm.set("avatarFile", new Blob([guestJpeg], { type: "image/jpeg" }), "guest.jpg");
  await fetch(new URL("/profile/avatar", baseUrl), { method: "POST", headers: { cookie: guestCookie }, body: guestForm });
  const guestProfile = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie: guestCookie } })).text();
  const guestAvatarUrl = guestProfile.match(/\/uploads\/avatar\/[0-9a-f-]+\.webp/)?.[0];
  expect(guestAvatarUrl).toBeTruthy();
  expect(guestAvatarUrl).not.toBe(hostAvatarUrl);

  await fetch(new URL(`/rooms/${code}/ask`, baseUrl), {
    method: "POST",
    headers: { cookie: guestCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ question: "is it a clue", kind: "question" }),
  });

  // Both sessions' own SSR views of the room should show the message with
  // the GUEST's own avatar (the author), never the viewing session's own.
  const roomAsHost = await (
    await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie: hostCookie } })
  ).text();
  const roomAsGuest = await (
    await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie: guestCookie } })
  ).text();
  for (const html of [roomAsHost, roomAsGuest]) {
    const entryStart = html.indexOf("is it a clue");
    const liStart = html.lastIndexOf("<li", entryStart);
    const liEnd = html.indexOf("</li>", entryStart);
    const li = html.slice(liStart, liEnd);
    expect(li, "the question entry should show the guest's own avatar, regardless of viewer").toContain(
      guestAvatarUrl!,
    );
    expect(li).not.toContain(hostAvatarUrl!);
  }
});

// ---------- Legacy emoji vs. image-preset id: never shown as a text prefix ----------
// sessions.avatar holds either a legacy emoji (AVATARS) or an AI-art preset
// id ("mystery", "observer", AVATAR_PRESETS) — only the emoji case is ever
// prefixed onto a nickname as display text (src/db.ts's displayLabel()/
// hostLabel(), src/render/layout.ts, src/render/community.ts). A real bug
// this caught: selecting the "observer" preset showed "observer Yan" as if
// "observer" were part of the player's own name.

it("selecting an image-preset avatar never shows the preset id as a text prefix on the nickname", async () => {
  const first = await fetch(new URL("/", baseUrl), { redirect: "manual" });
  const cookie = parseCookie(first.headers.getSetCookie());

  await fetch(new URL("/profile", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ nickname: "Yan", avatar: "observer" }),
    redirect: "manual",
  });

  const createRoom = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { cookie },
    redirect: "manual",
  });
  const code = (createRoom.headers.get("location") ?? "").split("/").pop();
  const roomHtml = await (await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie } })).text();
  expect(roomHtml).toContain(">Yan<");
  expect(roomHtml).not.toContain("observer Yan");

  // The header's own identity link uses the same rule.
  const home = await (await fetch(new URL("/", baseUrl), { headers: { cookie } })).text();
  expect(home).toContain(">Yan<");
  expect(home).not.toContain("observer Yan");
});

// ---------- Avatar-specific rejection wording ----------

it("an avatar rejection notice talks about an avatar, never a cover image", async () => {
  const first = await fetch(new URL("/", baseUrl), { redirect: "manual" });
  const cookie = parseCookie(first.headers.getSetCookie());

  const fakeBytes = new TextEncoder().encode("definitely not an image".repeat(10));
  const badForm = new FormData();
  badForm.set("avatarFile", new Blob([fakeBytes], { type: "image/png" }), "fake.png");
  const res = await fetch(new URL("/profile/avatar", baseUrl), {
    method: "POST",
    headers: { cookie },
    body: badForm,
    redirect: "manual",
  });
  expect(res.headers.get("location")).toContain("notice=corrupt");

  const html = await (
    await fetch(new URL(res.headers.get("location")!, baseUrl), { headers: { cookie } })
  ).text();
  expect(html).toMatch(/avatar image couldn't be read/);
  expect(html).not.toMatch(/cover image/);
});

// ---------- Cross-origin protection (same pattern spec/community.test.ts uses) ----------

it("rejects a cross-origin POST to the avatar routes and the plain profile save", async () => {
  const forgedHeaders = { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" };
  const saveRes = await fetch(new URL("/profile", baseUrl), {
    method: "POST",
    headers: forgedHeaders,
    body: new URLSearchParams({ nickname: "Forged" }),
    redirect: "manual",
  });
  expect(saveRes.status).toBe(403);

  const removeRes = await fetch(new URL("/profile/avatar/remove", baseUrl), {
    method: "POST",
    headers: { origin: "https://evil.example" },
    redirect: "manual",
  });
  expect(removeRes.status).toBe(403);
});

// ---------- Live avatar/presence refresh for an open room tab ----------
// Changing your avatar while sitting in an open room should update both the
// live member list AND every already-rendered message you've sent, without
// a page reload — src/sse.ts's updateAvatarForSession() plus
// src/routes/rooms.ts's broadcastAvatarUpdate()/broadcastRoomPresence(),
// triggered from routes/profile.ts's refreshLiveAvatar().

it("uploading an avatar while connected to a room's SSE stream broadcasts a presence update and an avatar-update event for that session only", async () => {
  const createRes = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ mode: "existing" }),
    redirect: "manual",
  });
  const code = (createRes.headers.get("location") ?? "").split("/").pop() ?? "";
  const cookie = parseCookie(createRes.headers.getSetCookie());

  // Open a live SSE connection as this same session before changing avatar.
  const streamController = new AbortController();
  const streamRes = await fetch(new URL(`/rooms/${code}/stream`, baseUrl), {
    headers: { cookie },
    signal: streamController.signal,
  });
  const reader = streamRes.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function nextEvent(): Promise<{ event: string; data: string }> {
    for (;;) {
      const idx = buffer.indexOf("\n\n");
      if (idx !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let event = "message";
        let data = "";
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7);
          else if (line.startsWith("data: ")) data = line.slice(6);
        }
        if (event === "heartbeat") continue;
        return { event, data };
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended early");
      buffer += decoder.decode(value, { stream: true });
    }
  }

  await nextEvent(); // this connection's own initial "presence" broadcast

  const jpeg = await makeAvatarJpeg({ r: 15, g: 200, b: 15 });
  const form = new FormData();
  form.set("avatarFile", new Blob([jpeg], { type: "image/jpeg" }), "live.jpg");
  await fetch(new URL("/profile/avatar", baseUrl), { method: "POST", headers: { cookie }, body: form });

  const first = await nextEvent();
  const second = await nextEvent();
  const events = [first, second];
  const presence = events.find((e) => e.event === "presence");
  const avatarUpdate = events.find((e) => e.event === "avatar-update");
  expect(presence, "an avatar change should re-broadcast presence").toBeTruthy();
  expect(avatarUpdate, "an avatar change should broadcast a targeted avatar-update event").toBeTruthy();

  const { sessionId, avatarUrl } = JSON.parse(avatarUpdate!.data);
  expect(avatarUrl).toMatch(/\/uploads\/avatar\/[0-9a-f-]+\.webp/);
  expect(typeof sessionId).toBe("string");

  const members = JSON.parse(presence!.data).members as { avatarUrl: string }[];
  expect(members.some((m) => m.avatarUrl === avatarUrl)).toBe(true);

  streamController.abort();
});
