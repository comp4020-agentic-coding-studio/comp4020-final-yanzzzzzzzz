import { asset } from "./asset.ts";

// Only the three puzzles stable enough to have ever gotten a dedicated
// commission (see ASSET_LICENSES.md for the generation prompts) get their
// own cover — matched by each puzzle's stable `slug`
// (src/data/puzzles.ts/reconcileSeedPuzzles()), never by title text, which
// can be reworded without the puzzle becoming a "different" case. Every
// other case — the remaining five built-ins, and any player-authored shared
// puzzle — uses the same original archive-desk photograph as a shared cover,
// so nothing ever falls back to a broken image or an emoji placeholder.
const STABLE_COVERS: Record<string, string> = {
  "turtle-soup-bowl": "/images/mystery/case-soup.webp",
  "silent-phone-call": "/images/mystery/case-phone.webp",
  "elevator-routine": "/images/mystery/case-elevator.webp",
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
