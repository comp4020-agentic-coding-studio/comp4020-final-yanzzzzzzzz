import type { Profile } from "../db.ts";
import { layout } from "./layout.ts";
import { escapeHtml } from "./html.ts";

export interface CaseListing {
  id: string;
  title: string;
  premise: string;
  authorLabel: string | null;
  usageCount: number;
}

function caseListingHtml(puzzle: CaseListing): string {
  const by = puzzle.authorLabel ? `by ${escapeHtml(puzzle.authorLabel)}` : "official case";
  return `<li class="case-browse-card">
    <h3>${escapeHtml(puzzle.title)}</h3>
    <p class="case-browse-author">${by} · used ${puzzle.usageCount}×</p>
    <p class="case-browse-premise">${escapeHtml(puzzle.premise)}</p>
    <div class="case-browse-actions">
      <a href="/rooms/new?puzzleId=${encodeURIComponent(puzzle.id)}" class="button-link-outline">Play this case</a>
      <a href="/community?puzzleId=${encodeURIComponent(puzzle.id)}">Read reviews</a>
    </div>
  </li>`;
}

export function casesPage(args: { puzzles: CaseListing[]; profile: Profile; q?: string }): string {
  const { puzzles, profile, q } = args;
  return layout(
    "Browse cases · Turtle Soup Puzzle Room",
    `
    <section class="case-browse">
      <h1>Browse every case</h1>
      <p class="case-browse-blurb">
        Every case currently open to play — the premise is shown in full, the
        solution stays with the AI judge until someone solves it.
      </p>

      <form method="get" action="/cases" class="case-search" role="search">
        <label for="q">Search by title or premise</label>
        <input type="text" id="q" name="q" maxlength="80" autocomplete="off" value="${escapeHtml(q ?? "")}" />
        <button type="submit">Search</button>
      </form>

      <p class="case-browse-empty" ${puzzles.length ? "hidden" : ""}>
        No cases match that search.
      </p>
      <ul class="case-browse-list">
        ${puzzles.map(caseListingHtml).join("\n")}
      </ul>
    </section>
    `,
    profile,
    "cases",
  );
}
