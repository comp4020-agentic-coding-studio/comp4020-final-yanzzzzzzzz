import type { Profile } from "../db.ts";
import { layout } from "./layout.ts";
import { escapeHtml } from "./html.ts";
import { asset } from "./asset.ts";
import { coverFor } from "./covers.ts";

export interface PuzzleOption {
  id: string;
  slug: string | null;
  title: string;
  premise: string;
  authorLabel: string | null;
  usageCount: number;
  coverPath: string | null;
}

// The folder's own pair of tabs — plain links to the same route with a
// different ?mode=, not JS-driven tab panels, so the page works identically
// with no script and the browser's own back/forward/reload all do the
// obvious thing.
function tabsHtml(mode: "existing" | "author"): string {
  return `<nav class="case-tabs" aria-label="Case source">
    <a href="/rooms/new?mode=existing" class="${mode === "existing" ? "active" : ""}" aria-current="${mode === "existing" ? "page" : "false"}">Choose a case</a>
    <a href="/rooms/new?mode=author" class="${mode === "author" ? "active" : ""}" aria-current="${mode === "author" ? "page" : "false"}">Write your own</a>
  </nav>`;
}

// "Surprise me" deliberately never shows a real cover, title, or premise —
// those would all be sealed-until-solved facts about whatever
// pickRandomPuzzle() ends up choosing at submit time, and rendering them
// here (even styled as a guess) would be showing a specific story as if it
// were already decided, which it isn't. A player who wants to see what
// they're committing to has "Choose a case" right next to this tab.
function sealedCasePreview(): string {
  return `<div class="case-file-panel case-file-preview" id="case-file-preview">
    <div class="case-file-cover case-file-cover-sealed" aria-hidden="true">
      <span class="case-file-seal">?</span>
    </div>
    <p class="case-file-source">Sealed case</p>
    <h2 class="case-file-title">Let fate choose your mystery</h2>
    <p class="case-file-premise">
      A random case is assigned the moment you create the room — nobody,
      including you, knows which one until the file opens.
    </p>
  </div>`;
}

function puzzleCasePreview(puzzle: PuzzleOption): string {
  const by = puzzle.authorLabel ? `Player-created, by ${escapeHtml(puzzle.authorLabel)}` : "Official case";
  return `<div class="case-file-panel case-file-preview" id="case-file-preview">
    <div class="case-file-cover">
      <img src="${coverFor(puzzle.slug, puzzle.id, puzzle.coverPath)}" alt="" width="800" height="500" decoding="async" />
    </div>
    <p class="case-file-source">${by}</p>
    <h2 class="case-file-title">${escapeHtml(puzzle.title)}</h2>
    <p class="case-file-premise">${escapeHtml(puzzle.premise)}</p>
  </div>`;
}

// Existing-case mode reads left-to-right (and, on a single-column phone, top
// to bottom) as "pick a case and name your room" THEN "here's what you
// picked" — the decision comes before its confirmation, so the settings
// panel is first in the DOM/visually-left, the read-only preview second/
// visually-right. Author mode (below) reverses that: writing the case IS
// the primary task, so its content panel comes first.
function existingCaseFileHtml(puzzles: PuzzleOption[], selectedPuzzleId?: string): string {
  const selected = selectedPuzzleId ? puzzles.find((p) => p.id === selectedPuzzleId) : undefined;
  const options = puzzles
    .map((p) => {
      const by = p.authorLabel ? ` — by ${escapeHtml(p.authorLabel)}` : " — official";
      const isSelected = p.id === selectedPuzzleId ? " selected" : "";
      return `<option value="${p.id}"${isSelected}>${escapeHtml(p.title)}${by} (used ${p.usageCount}×)</option>`;
    })
    .join("\n");

  // Both "pages" of the desk spread are inside this one <form> (a visual
  // two-column layout, not two separate documents) so a single POST still
  // carries the puzzle pick, the room name, and the submit button together —
  // no nested forms, no duplicate ids between modes since only one mode's
  // markup is ever rendered per request.
  return `<form method="post" action="/rooms" id="create-form" class="case-file-form">
    <input type="hidden" name="mode" value="existing" />

    <div class="case-file-panel case-file-settings">
      <h1 class="case-file-room-heading">Investigation room</h1>
      <p class="case-file-settings-blurb">
        Anyone with this room's code can walk in and read the case file —
        questions only start once you, as host, open the investigation.
      </p>

      <label for="puzzleId">Pick a case</label>
      <select id="puzzleId" name="puzzleId">
        <option value="" ${selectedPuzzleId ? "" : "selected"}>Surprise me</option>
        ${options}
      </select>

      <label for="name">Room name (optional)</label>
      <input type="text" id="name" name="name" maxlength="60" autocomplete="off" placeholder="Friday reasoning squad" />

      <button type="submit" class="button-link case-file-submit">Create investigation room</button>
      <a href="/cases" class="case-file-back-link">Back to the case library</a>
    </div>

    ${selected ? puzzleCasePreview(selected) : sealedCasePreview()}
  </form>
  <script id="puzzle-data" type="application/json">${JSON.stringify(
    puzzles.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      premise: p.premise,
      authorLabel: p.authorLabel,
      // The server-side resolved cover URL, not the raw coverPath filename —
      // create-case.js never needs to know the uploads directory's own
      // naming scheme, only the public URL every other cover already uses.
      coverUrl: coverFor(p.slug, p.id, p.coverPath),
    })),
  )}</script>`;
}

function authorCaseFileHtml(): string {
  // The content panel carries only what a player would eventually see
  // (title, premise) — the solution lives in the settings panel, explicitly
  // labelled hidden-until-solved, so the "sealed until solved" rule the rest
  // of the app enforces server-side is also true of this page's own layout:
  // nothing about to be secret sits in the panel styled as the public-facing
  // case content. `enctype="multipart/form-data"` is required for the file
  // input below to actually submit bytes (not just a filename string) —
  // the server (routes/rooms.ts) re-validates every field regardless, so
  // this changes nothing about what's trusted, only what the browser is
  // able to send.
  return `<form method="post" action="/rooms" id="create-form" class="case-file-form" enctype="multipart/form-data">
    <input type="hidden" name="mode" value="author" />
    <div class="case-file-panel case-file-fields">
      <div class="case-file-cover case-file-cover-author" id="cover-preview" aria-hidden="true">
        <span class="case-file-seal">✎</span>
      </div>
      <label for="cover" class="case-file-field-label">Cover image (optional)</label>
      <input type="file" id="cover" name="cover" accept="image/jpeg,image/png,image/webp" />
      <button type="button" id="cover-remove" class="case-file-cover-remove" hidden>Remove selected image</button>
      <p class="case-file-cover-hint">JPEG, PNG, or WebP, up to 2 MiB. No GIF or SVG.</p>
      <p class="case-file-source">Your case</p>
      <label for="title" class="case-file-field-label">Case title</label>
      <input type="text" id="title" name="title" maxlength="80" required autocomplete="off" placeholder="The Elevator Routine" class="case-file-title-input" />

      <label for="premise" class="case-file-field-label">Premise (what players see)</label>
      <textarea id="premise" name="premise" maxlength="1000" required rows="5" placeholder="A short, strange scene with no explanation attached."></textarea>
    </div>

    <div class="case-file-panel case-file-settings">
      <h1 class="case-file-room-heading">Investigation room</h1>

      <label for="solution">Solution <span class="case-file-hint">(hidden until solved)</span></label>
      <textarea id="solution" name="solution" maxlength="2000" required rows="4" placeholder="Explain the full truth, the reason, and any key detail the AI judge needs to tell a correct guess from a close one."></textarea>

      <label class="checkbox-label">
        <input type="checkbox" name="shared" id="shared" />
        Share to the public case library, so other players can pick it too
      </label>

      <label for="name">Room name (optional)</label>
      <input type="text" id="name" name="name" maxlength="60" autocomplete="off" placeholder="Friday reasoning squad" />

      <button type="submit" id="create-submit" class="button-link case-file-submit">Create investigation room</button>
      <a href="/cases" class="case-file-back-link">Back to the case library</a>
    </div>
  </form>`;
}

export function newRoomPage(args: {
  mode: "existing" | "author";
  puzzles: PuzzleOption[];
  profile: Profile;
  notice?: string;
  selectedPuzzleId?: string;
}): string {
  const { mode, puzzles, profile, notice, selectedPuzzleId } = args;
  return layout(
    "Start a new case · Turtle Soup Puzzle Room",
    `
    <section class="create-case">
      <h1 class="create-case-heading">Start a new case</h1>
      ${notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : ""}
      <div id="case-file-mode-root" data-mode="${mode}">
        ${tabsHtml(mode)}
        ${mode === "existing" ? existingCaseFileHtml(puzzles, selectedPuzzleId) : authorCaseFileHtml()}
      </div>
    </section>
    <script src="${asset("/create-case.js")}"></script>
    `,
    profile,
  );
}
