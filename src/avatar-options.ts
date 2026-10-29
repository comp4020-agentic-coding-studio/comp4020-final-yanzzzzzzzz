// The fixed set of plain-emoji avatar choices (src/render/profile.ts's
// picker) and the AI-art preset ids (src/render/avatars.ts's
// AVATAR_PRESETS) share one `avatar` column (sessions.avatar) but need very
// different display treatment: an emoji is short, glyph-only text that
// reads fine prefixed directly onto a nickname ("🐢 Riko"); a preset id
// ("mystery", "observer") is an internal key, not display text, and must
// NEVER be prefixed onto a nickname the way an emoji is — doing so would
// show literally "observer Riko" as if it were the player's own name.
//
// Kept in this tiny, dependency-free module (no import of db.ts, uploads.ts,
// or any render/*.ts) specifically so db.ts can check "is this value an
// emoji I should prefix" without creating an import cycle through
// render/avatars.ts (which itself imports db.ts for getProfile()).
export const AVATAR_EMOJIS = ["🕵️", "🔍", "🐢", "🔦", "🧩", "🗝️", "📖", "🧠"];

export function isLegacyEmojiAvatar(avatar: string | null): avatar is string {
  return avatar !== null && AVATAR_EMOJIS.includes(avatar);
}
