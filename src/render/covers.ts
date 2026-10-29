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
