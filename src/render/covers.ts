import { asset } from "./asset.ts";

// Every one of the eight built-in puzzles has its own dedicated commission
// (see ASSET_LICENSES.md for the generation prompts) — matched by each
// puzzle's stable `slug` (src/data/puzzles.ts/reconcileSeedPuzzles()), never
// by title text, which can be reworded without the puzzle becoming a
// "different" case. Any player-authored shared puzzle with no cover of its
// own still uses the same original archive-desk photograph as a fallback,
// so nothing ever falls back to a broken image or an emoji placeholder.
const STABLE_COVERS: Record<string, string> = {
  "turtle-soup-bowl": "/images/mystery/case-soup.webp",
  "silent-phone-call": "/images/mystery/case-phone.webp",
  "elevator-routine": "/images/mystery/case-elevator.webp",
  "desert-parachute": "/images/mystery/case-desert.webp",
  "avoided-gas-station": "/images/mystery/case-gas-station.webp",
  "discarded-shoes": "/images/mystery/case-shoes.webp",
  "man-and-straw": "/images/mystery/case-straw.webp",
  "dinner-party-soup": "/images/mystery/case-dinner.webp",
};

const ARCHIVE_COVER = "/images/mystery/case-archive.webp";

// `puzzleId` is only ever used to build the uploaded-cover route's URL
// (never to look anything up itself) — pass it so a player-authored
// puzzle's own uploaded cover (src/uploads.ts, served through
// routes/rooms.ts's own access-checked GET /uploads/cover/:puzzleId) takes
// priority over the shared archive photo; every other puzzle (every
// built-in, and any authored puzzle with no cover chosen) is completely
// unaffected and keeps resolving through the existing two-tier fallback.
export function coverFor(
  slug: string | null | undefined,
  puzzleId?: string,
  coverPath?: string | null,
): string {
  if (coverPath && puzzleId) return `/uploads/cover/${encodeURIComponent(puzzleId)}`;
  return asset((slug && STABLE_COVERS[slug]) || ARCHIVE_COVER);
}

// The lobby/home room cards show a thumbnail for every room someone can see
// in the list — including rooms for a PRIVATE (unshared) authored puzzle,
// which nobody viewing the lobby has joined yet. canViewPuzzleCover() (used
// by GET /uploads/cover/:puzzleId) deliberately requires either a shared
// puzzle, its own author, or an existing room_participants row — none of
// which a lobby browser has. Rather than loosening that check for every
// caller, a room card's cover resolves through a narrower, room-code-scoped
// route (GET /rooms/:code/cover, routes/rooms.ts) that only ever serves the
// image — never the puzzle's title/premise/solution — and only for a room
// that's currently actually listed (status waiting/active, the same rows
// listActiveRooms() returns); once a room is solved or gone, this URL 404s
// exactly like the room itself would stop appearing in the list.
export function coverForRoom(slug: string | null | undefined, code: string, coverPath?: string | null): string {
  if (coverPath) return `/rooms/${encodeURIComponent(code)}/cover`;
  return asset((slug && STABLE_COVERS[slug]) || ARCHIVE_COVER);
}
