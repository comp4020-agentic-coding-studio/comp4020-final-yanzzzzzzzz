import type { Profile } from "../db.ts";
import { layout } from "./layout.ts";
import { escapeHtml } from "./html.ts";

export interface PuzzleOption {
  id: string;
  title: string;
  premise: string;
  authorLabel: string | null;
  usageCount: number;
}

function tabsHtml(mode: "existing" | "author"): string {
  return `<nav class="create-tabs" aria-label="Case source">
    <a href="/rooms/new?mode=existing" class="${mode === "existing" ? "active" : ""}" aria-current="${mode === "existing" ? "page" : "false"}">Choose an existing case</a>
    <a href="/rooms/new?mode=author" class="${mode === "author" ? "active" : ""}" aria-current="${mode === "author" ? "page" : "false"}">Write your own</a>
  </nav>`;
}

function existingFormHtml(puzzles: PuzzleOption[]): string {
  const options = puzzles
    .map((p) => {
      const by = p.authorLabel ? ` — by ${escapeHtml(p.authorLabel)}` : " — official";
      return `<option value="${p.id}">${escapeHtml(p.title)}${by} (used ${p.usageCount}×)</option>`;
    })
    .join("\n");

  return `<form method="post" action="/rooms" id="create-form">
    <input type="hidden" name="mode" value="existing" />
    <label for="puzzleId">Pick a case</label>
    <select id="puzzleId" name="puzzleId">
      <option value="">Surprise me</option>
      ${options}
    </select>
    <p class="puzzle-preview" id="puzzle-preview" hidden></p>

    <label for="name">Room name (optional)</label>
    <input type="text" id="name" name="name" maxlength="60" autocomplete="off" placeholder="Friday reasoning squad" />

    <button type="submit">Create room</button>
  </form>
  <script id="puzzle-data" type="application/json">${JSON.stringify(
    puzzles.map((p) => ({ id: p.id, title: p.title, premise: p.premise })),
  )}</script>`;
}

function authorFormHtml(): string {
  return `<form method="post" action="/rooms" id="create-form">
    <input type="hidden" name="mode" value="author" />
    <label for="title">Case title</label>
    <input type="text" id="title" name="title" maxlength="80" required autocomplete="off" placeholder="The Elevator Routine" />

    <label for="premise">Premise (what players see — the 汤面)</label>
    <textarea id="premise" name="premise" maxlength="1000" required rows="3"></textarea>

    <label for="solution">Solution (hidden until solved — the 汤底)</label>
    <textarea id="solution" name="solution" maxlength="2000" required rows="4" placeholder="Explain the full truth, the reason, and any key detail the AI judge needs to tell a correct guess from a close one."></textarea>

    <label class="checkbox-label">
      <input type="checkbox" name="shared" id="shared" />
      Share to the public case library, so other players can pick it too
    </label>

    <label for="name">Room name (optional)</label>
    <input type="text" id="name" name="name" maxlength="60" autocomplete="off" placeholder="Friday reasoning squad" />

    <button type="submit" id="create-submit">Create room</button>
  </form>`;
}

export function newRoomPage(args: {
  mode: "existing" | "author";
  puzzles: PuzzleOption[];
  profile: Profile;
  notice?: string;
}): string {
  const { mode, puzzles, profile, notice } = args;
  return layout(
    "Start a new case · Turtle Soup Puzzle Room",
    `
    <section class="create-case">
      <h1>Start a new case</h1>
      ${notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : ""}
      ${tabsHtml(mode)}
      ${mode === "existing" ? existingFormHtml(puzzles) : authorFormHtml()}
    </section>
    <script src="/create-case.js"></script>
    `,
    profile,
  );
}
