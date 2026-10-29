import type { LobbyRoom, Profile } from "../db.ts";
import { layout } from "./layout.ts";
import { escapeHtml } from "./html.ts";
import { asset } from "./asset.ts";
import { coverFor } from "./covers.ts";
import { JUDGE_DISPLAY_NAME } from "../llm.ts";

export interface LobbyCardRoom extends LobbyRoom {
  players: number;
  hostLabel: string;
  coverUrl: string;
}

function statusLabel(status: LobbyRoom["status"]): string {
  return status === "waiting" ? "Not started yet" : "In progress";
}

function caseCardHtml(room: LobbyCardRoom): string {
  const roomName = room.name ? escapeHtml(room.name) : `Case ${room.code}`;
  const statusClass = room.status === "waiting" ? "case-status-waiting" : "case-status-active";
  return `<li class="case-card" data-code="${room.code}">
    <div class="case-card-cover">
      <img src="${escapeHtml(room.coverUrl)}" alt="" width="800" height="500" loading="lazy" decoding="async" />
    </div>
    <div class="case-card-main">
      <h3>${roomName}</h3>
      <p class="case-card-puzzle">playing <strong>${escapeHtml(room.title)}</strong></p>
      <p class="case-card-meta">
        <span class="case-code">Code <code>${room.code}</code></span>
        <span class="case-host">Hosted by ${escapeHtml(room.hostLabel)}</span>
        <span class="case-status ${statusClass}">${statusLabel(room.status)}</span>
        <span class="case-players">${room.players} online</span>
      </p>
    </div>
    <a href="/rooms/${room.code}" class="case-join">Join case</a>
  </li>`;
}

// Three clean step markers (numbered discs, not an emoji wall) — the case
// a precise design brief explicitly asked for: "clear symbols or thin native
// SVG, no emoji wall."
function stepIcon(n: number): string {
  return `<span class="step-number" aria-hidden="true">${n}</span>`;
}

function stepsHtml(): string {
  return `<ol class="how-it-works">
    <li>
      ${stepIcon(1)}
      <h3>Read the premise</h3>
      <p>A short, strange scene — someone did something for a reason nobody's told you.</p>
    </li>
    <li>
      ${stepIcon(2)}
      <h3>Ask yes / no / irrelevant questions</h3>
      <p>${escapeHtml(JUDGE_DISPLAY_NAME)} holds the full solution and answers every question honestly, one at a time.</p>
    </li>
    <li>
      ${stepIcon(3)}
      <h3>Piece together the truth</h3>
      <p>Submit a final guess whenever you think you've got it — solo, or with the room watching together.</p>
    </li>
  </ol>`;
}

function faqHtml(): string {
  const items: [string, string][] = [
    [
      "Is there a limit on how many questions I can ask?",
      "No. Ask as many yes/no questions as you need — there's no fixed question budget, just a short per-person cooldown so one player can't flood the judge.",
    ],
    [
      "Is there a single correct answer?",
      `Yes. Every case has one solution ${JUDGE_DISPLAY_NAME} holds from the start; a guess is judged against that solution, not against vibes.`,
    ],
    [
      "Do I need an account?",
      "No. You get an anonymous session the moment you load the page — enough to tell players apart in a room — and can optionally set a nickname and avatar on your profile.",
    ],
    [
      "Can I play alone?",
      "Yes. Starting a case puts you in a room by yourself; anyone with the room's code can join you mid-game.",
    ],
    [
      "What happens when someone solves it?",
      "The room flips to solved for everyone watching, live, and shows the full solution plus a short recap — how many questions it took, how many people were there, and how long it took.",
    ],
  ];
  // Each question is its own <details>, not one button gating the whole
  // section — collapsed by default, independently openable, and fully
  // keyboard/no-JS usable since <details>/<summary> is native browser
  // behavior (Enter/Space on a focused <summary> toggles it) with no script
  // required. The plus/minus glyph is a plain ::before indicator driven by
  // the browser's own [open] attribute, not JS-tracked state.
  return `<section class="faq">
    <h2>FAQ</h2>
    <div class="faq-list">
      ${items
        .map(
          ([q, a]) => `<details class="faq-item">
        <summary>${escapeHtml(q)}</summary>
        <p>${escapeHtml(a)}</p>
      </details>`,
        )
        .join("\n")}
    </div>
  </section>`;
}

function formatReasoningTime(totalSeconds: number): string {
  if (totalSeconds < 60) return "Less than a minute";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export interface FeaturedPuzzle {
  id: string;
  slug: string | null;
  title: string;
  premise: string;
  coverPath: string | null;
}

function featuredCaseHtml(puzzle: FeaturedPuzzle): string {
  // Full premise text stays intact (never truncated with an ellipsis that
  // would quietly drop part of a real case's setup) — the card's fixed
  // height and -webkit-line-clamp handle overflow visually, but the markup
  // itself carries the complete sentence.
  return `<li class="featured-card">
    <a href="/rooms/new?puzzleId=${encodeURIComponent(puzzle.id)}" class="featured-cover-link">
      <img
        class="featured-cover"
        src="${coverFor(puzzle.slug, puzzle.id, puzzle.coverPath)}"
        alt=""
        width="800"
        height="500"
        loading="lazy"
        decoding="async"
      />
    </a>
    <div class="featured-body">
      <h3>${escapeHtml(puzzle.title)}</h3>
      <p class="featured-premise">${escapeHtml(puzzle.premise)}</p>
      <p class="featured-source">Official case</p>
      <a href="/rooms/new?puzzleId=${encodeURIComponent(puzzle.id)}" class="button-link-outline featured-play">Play this case</a>
    </div>
  </li>`;
}

export function homePage(args: {
  rooms: LobbyCardRoom[];
  profile: Profile;
  reasoningSeconds: number;
  featuredPuzzles: FeaturedPuzzle[];
}): string {
  const { rooms, profile, reasoningSeconds, featuredPuzzles } = args;
  return layout(
    "Turtle Soup Puzzle Room",
    `
    <section class="hero">
      <picture class="hero-media">
        <source
          type="image/webp"
          srcset="${asset("/images/mystery/hero-mystery-640.webp")} 640w, ${asset("/images/mystery/hero-mystery-1200.webp")} 1200w, ${asset("/images/mystery/hero-mystery-1600.webp")} 1600w"
          sizes="100vw"
        />
        <img
          src="${asset("/images/mystery/hero-mystery-1200.jpg")}"
          alt="A steaming bowl of soup and a magnifying glass on a lamplit detective's desk at night, rain on the window behind it"
          width="1600"
          height="900"
          fetchpriority="high"
        />
      </picture>
      <div class="hero-overlay" aria-hidden="true"></div>
      <div class="hero-copy">
        <h1>Every strange ending hides a story.</h1>
        <p class="hero-tagline">Ask together. Uncover the truth.</p>
        <p class="hero-blurb">Unravel strange stories with friends, one question at a time.</p>
        <div class="hero-actions">
          <a href="/rooms/new" class="button-link hero-cta-primary">Create a room</a>
          <a href="/cases" class="button-link-outline hero-cta-secondary">Explore cases</a>
        </div>
      </div>
    </section>

    <section class="below-hero-info" aria-label="Before you play">
      <p class="content-warning" role="note">
        <span class="content-warning-icon" aria-hidden="true">⚠️</span>
        Some stories contain horror or graphic content. Proceed with caution.
      </p>
      <p class="reasoning-total" id="reasoning-total" data-reasoning-seconds="${reasoningSeconds}">
        <strong>${formatReasoningTime(reasoningSeconds)}</strong> of shared reasoning across all rooms
      </p>
    </section>

    <section class="join-strip" aria-label="Join an existing case">
      <form method="get" action="/join" class="join-form">
        <label for="join-code">Have an invitation code?</label>
        <input type="text" id="join-code" name="code" maxlength="5" autocomplete="off" placeholder="ABCDE" />
        <button type="submit" class="join-button">Join</button>
      </form>
    </section>

    <section class="featured-cases">
      <h2>Featured cases</h2>
      <p class="featured-blurb">A taste of the case library — the solution stays secret until someone solves it.</p>
      <ul class="featured-list">
        ${featuredPuzzles.map(featuredCaseHtml).join("\n")}
      </ul>
      <a href="/cases" class="button-link-outline">Browse every case</a>
    </section>

    <section class="lobby">
      <h2>Open cases</h2>
      <p class="lobby-empty" ${rooms.length ? "hidden" : ""}>No open cases right now — be the first to start one.</p>
      <ul class="lobby-list" id="lobby-list">
        ${rooms.map(caseCardHtml).join("\n")}
      </ul>
    </section>

    <section class="how-section">
      <h2>How it plays</h2>
      ${stepsHtml()}
    </section>

    ${faqHtml()}
    <script src="${asset("/lobby.js")}"></script>
    `,
    profile,
    "home",
  );
}
