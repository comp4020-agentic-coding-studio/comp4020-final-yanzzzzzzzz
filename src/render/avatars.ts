import { asset } from "./asset.ts";
import { getProfile, type QaEntry } from "../db.ts";
import { JUDGE_REPLY_TEXTS } from "../llm.ts";

// Three AI-generated character portraits (src/data provenance in
// ASSET_LICENSES.md) — Watson's own fixed portrait (never player-selectable,
// always the judge's own image), the default every session with no chosen
// avatar falls back to, and one extra optional preset alongside the
// existing emoji choices.
export const WATSON_AVATAR = asset("/images/avatars/avatar-watson.webp");
export const DEFAULT_AVATAR = asset("/images/avatars/avatar-mystery.webp");

export const AVATAR_PRESETS: { id: string; src: string; label: string }[] = [
  { id: "mystery", src: DEFAULT_AVATAR, label: "Mystery (default)" },
  { id: "observer", src: asset("/images/avatars/avatar-observer.webp"), label: "Observer" },
];

// Single trusted resolver for "what image represents this session," used by
// every caller that renders a player's avatar (profile page, member list,
// room transcript SSR, the SSE payloads public/client.js renders from) —
// never built ad hoc per call site, so the priority order below
// (uploaded > selected preset/legacy emoji > default art) can't drift
// between two places that forgot to agree. `avatarImage` is a bare
// server-generated filename (sessions.avatar_image, src/uploads.ts) — never
// a raw filesystem path or anything upload-controlled beyond that filename,
// resolved here to the public GET /uploads/avatar/:file route
// (routes/profile.ts). `avatar` is either one of the existing emoji strings
// or one of AVATAR_PRESETS' `id` values; anything else (including a stale/
// unrecognized preset id) falls through to the default art, never an error.
export function resolveAvatarImage(args: { avatarImage: string | null; avatar: string | null }): string {
  if (args.avatarImage) return `/uploads/avatar/${encodeURIComponent(args.avatarImage)}`;
  const preset = AVATAR_PRESETS.find((p) => p.id === args.avatar);
  if (preset) return preset.src;
  return DEFAULT_AVATAR;
}

// An avatar image is a small, non-sensitive public identity picture (same
// visibility as a nickname) — unlike a puzzle cover, there's no
// private/shared distinction to gate, so every avatar image route is public
// with no session check, same as any other static asset under /public,
// just served from DATA_DIR instead because it's user-uploaded.
export function isKnownAvatarPreset(id: string): boolean {
  return AVATAR_PRESETS.some((p) => p.id === id);
}

// Resolves a transcript/member-list entry's avatar from the AUTHOR's own
// stored session, never the viewer's — every caller (SSR room.ts, the SSE
// payload routes/rooms.ts attaches before broadcast(), public/client.js's
// own mirror of this same lookup) passes the entry/member's own
// `session_id`, not whoever happens to be looking at the page. A `null`
// session_id (a plain system notice, or a judge reply which is never
// attributed to any session) has no profile to resolve — callers decide
// their own non-player visual for that case (e.g. no avatar at all for a
// plain notice, Watson's fixed portrait for a judge reply) rather than this
// function guessing.
export function avatarForSession(sessionId: string): string {
  const profile = getProfile(sessionId);
  return resolveAvatarImage({ avatarImage: profile.avatarImage, avatar: profile.avatar });
}

// A transcript entry's avatar, for exactly the three shapes a qa_entries row
// can be: a question/guess from a real session (that session's own avatar,
// never the viewer's), a judge reply (one of JUDGE_REPLY_TEXTS' fixed
// sentences — always Watson's own fixed portrait, matched the same way
// src/render/room.ts's systemEntryHtml() already decides the "AI judge"
// label), or a plain system notice with no author at all (no avatar, by
// returning null — a bare room event like "host started the investigation"
// isn't attributed to anyone, player or Watson). Used identically by SSR
// (src/render/room.ts) and the SSE payload (routes/rooms.ts attaches this
// before broadcast()) so a live-arriving entry never renders differently
// from one already in the server-rendered transcript.
export function entryAvatarUrl(entry: Pick<QaEntry, "session_id" | "body">): string | null {
  if (entry.session_id) return avatarForSession(entry.session_id);
  if (JUDGE_REPLY_TEXTS.has(entry.body)) return WATSON_AVATAR;
  return null;
}
