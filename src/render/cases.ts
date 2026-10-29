import type { Profile } from "../db.ts";
import { layout } from "./layout.ts";
import { escapeHtml } from "./html.ts";
import { coverFor } from "./covers.ts";
import { JUDGE_DISPLAY_NAME } from "../llm.ts";

export type CaseSource = "all" | "builtin" | "player";

export interface CaseListing {
  id: string;
  slug: string | null;
  title: string;
  premise: string;
  authorLabel: string | null;
  usageCount: number;
  coverPath: string | null;
}

function caseListingHtml(puzzle: CaseListing): string {
  const by = puzzle.authorLabel ? `Player-created, by ${escapeHtml(puzzle.authorLabel)}` : "Built-in case";
  return `<li class="case-browse-card">
    <a href="/rooms/new?puzzleId=${encodeURIComponent(puzzle.id)}" class="case-browse-cover-link">
      <img
        class="case-browse-cover"
        src="${coverFor(puzzle.slug, puzzle.id, puzzle.coverPath)}"
        alt=""
        width="800"
        height="500"
        loading="lazy"
        decoding="async"
      />
    </a>
    <div class="case-browse-body">
      <h3>${escapeHtml(puzzle.title)}</h3>
      <p class="case-browse-author">${by} · used ${puzzle.usageCount}×</p>
      <p class="case-browse-premise">${escapeHtml(puzzle.premise)}</p>
      <div class="case-browse-actions">
        <a href="/rooms/new?puzzleId=${encodeURIComponent(puzzle.id)}" class="button-link-outline">Play this case</a>
        <a href="/community?puzzleId=${encodeURIComponent(puzzle.id)}">Read reviews</a>
      </div>
    </div>
  </li>`;
}

function sourceFilterHtml(q: string | undefined, active: CaseSource): string {
  const tab = (value: CaseSource, label: string): string => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (value !== "all") params.set("source", value);
    const query = params.toString();
    const isActive = value === active;
    return `<a href="/cases${query ? `?${query}` : ""}"${isActive ? ' class="active" aria-current="page"' : ""}>${label}</a>`;
  };
  return `<nav class="case-source-filter" aria-label="Filter by source">
    ${tab("all", "All")}
    ${tab("builtin", "Built-in")}
    ${tab("player", "Player-created")}
  </nav>`;
}

export function casesPage(args: {
  puzzles: CaseListing[];
  profile: Profile;
  q?: string;
  source: CaseSource;
}): string {
  const { puzzles, profile, q, source } = args;
  return layout(
    "Case Library · Turtle Soup Puzzle Room",
    `
    <section class="case-browse">
      <h1>Case Library</h1>
      <p class="case-browse-blurb">
        Every case currently open to play — the full premise is shown, the
        solution stays with ${escapeHtml(JUDGE_DISPLAY_NAME)} until someone solves it.
      </p>

      <form method="get" action="/cases" class="case-search" role="search">
        <label for="q">Search by title or premise</label>
        <input type="text" id="q" name="q" maxlength="80" autocomplete="off" value="${escapeHtml(q ?? "")}" placeholder="turtle soup, elevator, dinner party…" />
        ${source !== "all" ? `<input type="hidden" name="source" value="${source}" />` : ""}
        <button type="submit">Search</button>
      </form>

      ${sourceFilterHtml(q, source)}

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
