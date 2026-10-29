import { Hono } from "hono";
import { getProfile, profileStats, setAvatarImage, setProfile } from "../db.ts";
import { getOrCreateSessionId } from "../session.ts";
import { AVATARS, profilePage } from "../render/profile.ts";
import { avatarForSession, isKnownAvatarPreset } from "../render/avatars.ts";
import {
  avatarFilePath,
  avatarRejectionMessage,
  deleteAvatarImage,
  processAvatarUpload,
} from "../uploads.ts";
import { readFile } from "node:fs/promises";
import { multipartBodyLimit } from "../body-limit.ts";
import { isSameOrigin } from "../same-origin.ts";
import { updateAvatarForSession } from "../sse.ts";
import { broadcastAvatarUpdate, broadcastRoomPresence } from "./rooms.ts";

// Comfortable room above the 2 MiB per-file avatar limit (src/uploads.ts)
// for multipart framing overhead — this route carries only the one file
// field, no other text fields, so the gap above 2 MiB can be much smaller
// than room-creation's 3 MiB cap.
const AVATAR_UPLOAD_BODY_LIMIT_BYTES = 2.5 * 1024 * 1024;

export const profileRoute = new Hono();

const AVATAR_NOTICES: Record<string, string> = {
  "too-large": avatarRejectionMessage("too-large"),
  "unsupported-format": avatarRejectionMessage("unsupported-format"),
  corrupt: avatarRejectionMessage("corrupt"),
  "pixel-limit": avatarRejectionMessage("pixel-limit"),
};

// After a rejected avatar upload, the redirect back to GET /profile carries
// whatever the player had already typed into the OTHER (separate) form's
// nickname/bio fields as plain query params — not saved anywhere, just
// round-tripped through the URL so profilePage() can re-fill the inputs
// instead of the player finding their unsaved typing silently gone. Never
// persisted: a reload of the plain /profile URL (no query string) shows
// whatever's actually saved, same as always.
function draftParams(c: { req: { query: (name: string) => string | undefined } }): {
  nickname?: string;
  bio?: string;
} {
  const nickname = c.req.query("draftNickname");
  const bio = c.req.query("draftBio");
  return { nickname, bio };
}

profileRoute.get("/profile", (c) => {
  const sessionId = getOrCreateSessionId(c);
  const profile = getProfile(sessionId);
  const stats = profileStats(sessionId);
  const saved = c.req.query("saved") === "1";
  const notice = AVATAR_NOTICES[c.req.query("notice") ?? ""];
  const draft = draftParams(c);
  return c.html(profilePage({ profile, stats, saved, notice, draft }));
});

// `avatar` (the existing emoji column) can hold either a legacy emoji from
// AVATARS or one of the AI-art preset ids (AVATAR_PRESETS) — both resolve
// through the same src/render/avatars.ts priority order, so this is the
// only place that has to know both are valid "avatar" values. A preset
// change here can change this session's effective avatar image too (if no
// uploaded image takes priority over it) — the same live SSE refresh as an
// upload/removal runs below, so an already-open room tab picks it up.
profileRoute.post("/profile", async (c) => {
  if (!isSameOrigin(c)) return c.body(null, 403);
  const sessionId = getOrCreateSessionId(c);
  const body = await c.req.parseBody();

  const nickname = String(body.nickname ?? "").trim().slice(0, 24) || null;
  const bio = String(body.bio ?? "").trim().slice(0, 140) || null;
  const requestedAvatar = String(body.avatar ?? "");
  const avatar =
    AVATARS.includes(requestedAvatar) || isKnownAvatarPreset(requestedAvatar) ? requestedAvatar : null;

  setProfile(sessionId, { nickname, avatar, bio });
  refreshLiveAvatar(sessionId);
  return c.redirect("/profile?saved=1", 303);
});

// Re-resolves this session's current avatar and pushes it to every room
// channel the session currently holds a live connection to — called after
// any save that could change the EFFECTIVE avatar image (an upload, a
// removal, or a plain preset/emoji change on the form above). Never touches
// a session with no open connections (updateAvatarForSession() simply finds
// nothing to update), and never affects any other session.
function refreshLiveAvatar(sessionId: string): void {
  const avatarUrl = avatarForSession(sessionId);
  const touchedRoomIds = updateAvatarForSession(sessionId, avatarUrl);
  for (const roomId of touchedRoomIds) {
    broadcastRoomPresence(roomId);
    broadcastAvatarUpdate(roomId, sessionId, avatarUrl);
  }
}

// Separate route (and separate <form>) from the plain profile save above —
// uploading/validating an image is a different failure mode (too-large,
// unsupported-format, corrupt) than a text-field save, and keeping them
// apart means a rejected avatar upload redirects back with its own notice
// without resubmitting (and re-validating away) the nickname/bio/emoji
// fields from the other form, and vice versa (db.ts's setProfile() never
// touches avatar_image at all, by design — see its own comment).
profileRoute.post(
  "/profile/avatar",
  multipartBodyLimit(AVATAR_UPLOAD_BODY_LIMIT_BYTES, "/profile?notice=too-large"),
  async (c) => {
    if (!isSameOrigin(c)) return c.body(null, 403);
    const sessionId = getOrCreateSessionId(c);
    const body = await c.req.parseBody();

    // The other form's nickname/bio, round-tripped as a draft on any
    // redirect below that doesn't itself save them — see draftParams().
    const draftQs = new URLSearchParams();
    const draftNickname = String(body.draftNickname ?? "");
    const draftBio = String(body.draftBio ?? "");
    if (draftNickname) draftQs.set("draftNickname", draftNickname);
    if (draftBio) draftQs.set("draftBio", draftBio);
    const draftSuffix = draftQs.size ? `&${draftQs.toString()}` : "";

    // Same real-browser sentinel shape as the cover-upload form
    // (routes/rooms.ts): an untouched <input type="file"> still submits as
    // a File with name "" and size 0, not a missing field.
    const isEmptyFileSentinel =
      body.avatarFile instanceof File && body.avatarFile.name === "" && body.avatarFile.size === 0;
    if (!(body.avatarFile instanceof File) || isEmptyFileSentinel) {
      return c.redirect(`/profile${draftSuffix ? `?${draftQs.toString()}` : ""}`, 303);
    }

    const result = await processAvatarUpload(body.avatarFile);
    if (!result.ok) {
      return c.redirect(`/profile?notice=${result.reason}${draftSuffix}`, 303);
    }

    const previous = getProfile(sessionId).avatarImage;
    setAvatarImage(sessionId, result.coverPath);
    // Deletes the PREVIOUS file only after the new one is already recorded
    // — never the other way around, so a crash between these two steps
    // leaves an orphaned old file (a disk-space concern) rather than a
    // profile pointing at a file that no longer exists.
    if (previous) deleteAvatarImage(previous);
    refreshLiveAvatar(sessionId);

    return c.redirect("/profile?saved=1", 303);
  },
);

profileRoute.post("/profile/avatar/remove", (c) => {
  if (!isSameOrigin(c)) return c.body(null, 403);
  const sessionId = getOrCreateSessionId(c);
  const previous = getProfile(sessionId).avatarImage;
  if (previous) {
    setAvatarImage(sessionId, null);
    deleteAvatarImage(previous);
    refreshLiveAvatar(sessionId);
  }
  return c.redirect("/profile?saved=1", 303);
});

// Public, no session/ownership check: an avatar image is a small,
// non-sensitive public identity picture (same visibility as a nickname is
// already), not a private/shared puzzle cover with access rules to enforce.
// Still strictly filename-only — never a path, never traversable — since
// `file` only ever selects among whatever processAvatarUpload() already
// wrote under its own fixed output directory (src/uploads.ts).
profileRoute.get("/uploads/avatar/:file", async (c) => {
  const file = c.req.param("file");
  if (!/^[0-9a-f-]+\.webp$/i.test(file)) return c.notFound();
  let bytes;
  try {
    bytes = await readFile(avatarFilePath(file));
  } catch {
    return c.notFound();
  }
  c.header("Content-Type", "image/webp");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(bytes);
});
