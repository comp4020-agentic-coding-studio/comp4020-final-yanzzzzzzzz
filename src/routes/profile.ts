import { Hono } from "hono";
import {
  getProfile,
  listOwnInvestigations,
  listOwnStories,
  profileStats,
  setAvatarImage,
  setProfile,
} from "../db.ts";
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

// After ANY /profile/avatar(/remove) redirect — success, rejection, or a
// no-file no-op — the player's unsaved nickname/bio typing in the OTHER
// (separate) form is carried back as plain query params, never saved
// anywhere: just round-tripped through the URL so profilePage() can re-fill
// the inputs instead of the player finding their unsaved typing silently
// gone. A reload of the plain /profile URL (no query string) always shows
// whatever's actually saved in the database, same as before this existed.
//
// Presence, not truthiness, decides whether a field is carried: the hidden
// draftNickname/draftBio inputs (public/profile-avatar.js) are always
// present in this form's submission once JS has run once, even when their
// value is now "" — e.g. the player had a saved nickname, cleared the text
// box, then uploaded an avatar before saving. Checking `body.draftNickname`
// alone would treat that empty string as "nothing to carry" and the draft
// param would silently vanish, which would make profilePage() fall back to
// re-displaying the OLD saved nickname — overwriting the player's visible
// clear-out with text they'd already deleted. `in body` preserves that
// explicit empty state through the redirect; only a genuinely absent field
// (this app's own hidden inputs are never absent, but a non-JS/non-browser
// submission could lack them) is left out of the query string entirely.
function draftQueryString(body: Record<string, unknown>): string {
  const draftQs = new URLSearchParams();
  if ("draftNickname" in body) draftQs.set("draftNickname", String(body.draftNickname ?? ""));
  if ("draftBio" in body) draftQs.set("draftBio", String(body.draftBio ?? ""));
  return draftQs.toString();
}

function redirectWithDraft(path: string, draftQs: string, extra?: string): string {
  const params = [draftQs, extra].filter(Boolean).join("&");
  return params ? `${path}?${params}` : path;
}

// Bounded to the same maxlength the nickname/bio <input>s themselves carry
// (src/render/profile.ts) — this is a redisplay-only value, never saved, but
// an oversized query string is still worth capping rather than handing an
// arbitrarily long attacker/accident-supplied string straight to the
// renderer's own escapeHtml() call.
function draftParams(c: { req: { query: (name: string) => string | undefined } }): {
  nickname?: string;
  bio?: string;
} {
  const nickname = c.req.query("draftNickname")?.slice(0, 24);
  const bio = c.req.query("draftBio")?.slice(0, 140);
  return { nickname, bio };
}

const HISTORY_PAGE_SIZE = 20;

// Bounds a page query param to a safe positive page number — an out-of-range
// or garbage value (negative, zero, non-numeric, absurdly large) falls back
// to page 1 rather than producing a negative OFFSET or an empty-looking page
// that's actually a server error in disguise.
const MAX_HISTORY_PAGE = 1_000_000;

function pageParam(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_HISTORY_PAGE ? n : 1;
}

profileRoute.get("/profile", (c) => {
  // The ENTIRE history/stories section below is scoped to this one id,
  // resolved only from the request's own session cookie — never from a
  // query param, so one player can never pull up another's investigation
  // history or uploaded-story list by guessing/passing a different id.
  const sessionId = getOrCreateSessionId(c);
  const profile = getProfile(sessionId);
  const stats = profileStats(sessionId);
  const saved = c.req.query("saved") === "1";
  const notice = AVATAR_NOTICES[c.req.query("notice") ?? ""];
  const draft = draftParams(c);

  const historyPage = pageParam(c.req.query("historyPage"));
  const history = listOwnInvestigations(sessionId, {
    limit: HISTORY_PAGE_SIZE,
    offset: (historyPage - 1) * HISTORY_PAGE_SIZE,
  });

  const storiesPage = pageParam(c.req.query("storiesPage"));
  const stories = listOwnStories(sessionId, {
    limit: HISTORY_PAGE_SIZE,
    offset: (storiesPage - 1) * HISTORY_PAGE_SIZE,
  });

  return c.html(
    profilePage({
      profile,
      stats,
      saved,
      notice,
      draft,
      history: { ...history, page: historyPage, pageSize: HISTORY_PAGE_SIZE },
      stories: { ...stories, page: storiesPage, pageSize: HISTORY_PAGE_SIZE },
    }),
  );
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

    // The other form's nickname/bio, round-tripped as a draft on EVERY
    // redirect below — including the success path, which does not itself
    // save these fields (db.ts's setProfile() is a separate save, never
    // called from this route) — see draftQueryString()'s own comment.
    const draftQs = draftQueryString(body);

    // Same real-browser sentinel shape as the cover-upload form
    // (routes/rooms.ts): an untouched <input type="file"> still submits as
    // a File with name "" and size 0, not a missing field.
    const isEmptyFileSentinel =
      body.avatarFile instanceof File && body.avatarFile.name === "" && body.avatarFile.size === 0;
    if (!(body.avatarFile instanceof File) || isEmptyFileSentinel) {
      return c.redirect(redirectWithDraft("/profile", draftQs), 303);
    }

    const result = await processAvatarUpload(body.avatarFile);
    if (!result.ok) {
      return c.redirect(redirectWithDraft("/profile", draftQs, `notice=${result.reason}`), 303);
    }

    const previous = getProfile(sessionId).avatarImage;
    setAvatarImage(sessionId, result.coverPath);
    // Deletes the PREVIOUS file only after the new one is already recorded
    // — never the other way around, so a crash between these two steps
    // leaves an orphaned old file (a disk-space concern) rather than a
    // profile pointing at a file that no longer exists.
    if (previous) deleteAvatarImage(previous);
    refreshLiveAvatar(sessionId);

    return c.redirect(redirectWithDraft("/profile", draftQs, "saved=1"), 303);
  },
);

// Reads the same hidden draftNickname/draftBio fields as POST /profile/avatar
// above (the "Remove uploaded avatar" button is a second submit button on
// that same <form>, see src/render/profile.ts — formaction routes it here,
// but the form's own fields, including the two hidden draft inputs, still
// submit with it) — needs its own parseBody() since this is a different
// request/handler, not a continuation of the upload one.
profileRoute.post("/profile/avatar/remove", async (c) => {
  if (!isSameOrigin(c)) return c.body(null, 403);
  const sessionId = getOrCreateSessionId(c);
  const body = await c.req.parseBody();
  const draftQs = draftQueryString(body);

  const previous = getProfile(sessionId).avatarImage;
  if (previous) {
    setAvatarImage(sessionId, null);
    deleteAvatarImage(previous);
    refreshLiveAvatar(sessionId);
  }
  return c.redirect(redirectWithDraft("/profile", draftQs, "saved=1"), 303);
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
