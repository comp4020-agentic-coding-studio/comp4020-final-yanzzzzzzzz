import type { LobbyRoom, Profile } from "../db.ts";
import { layout } from "./layout.ts";
import { escapeHtml } from "./html.ts";

export interface LobbyCardRoom extends LobbyRoom {
  players: number;
  hostLabel: string;
}

function statusLabel(status: LobbyRoom["status"]): string {
  return status === "waiting" ? "🆕 Not started yet" : "🔎 In progress";
}

function caseCardHtml(room: LobbyCardRoom): string {
  const roomName = room.name ? escapeHtml(room.name) : `Case ${room.code}`;
  return `<li class="case-card" data-code="${room.code}">
    <div class="case-card-main">
      <h3>${roomName}</h3>
      <p class="case-card-puzzle">playing <strong>${escapeHtml(room.title)}</strong></p>
      <p class="case-card-meta">
        <span class="case-code">Code: <code>${room.code}</code></span>
        <span class="case-host">👑 ${escapeHtml(room.hostLabel)}</span>
        <span class="case-status">${statusLabel(room.status)}</span>
        <span class="case-players">👥 ${room.players}</span>
      </p>
    </div>
    <a href="/rooms/${room.code}" class="case-join">Join</a>
  </li>`;
}

// One small original illustration, built entirely from inline SVG shapes
// (no traced or copied artwork) — a bowl, rising steam, and a question mark
// where the solution would be, framed in the palette's own navy/gold rather
// than any reference site's colors.
function bowlIllustration(): string {
  return `<svg class="hero-illustration" viewBox="0 0 220 180" role="img" aria-labelledby="bowl-svg-title" width="220" height="180">
    <title id="bowl-svg-title">A steaming bowl of soup with a question mark rising from it, and a magnifying glass resting beside it</title>
    <g class="steam">
      <path d="M90 60 C 80 45, 100 40, 92 25 C 86 14, 98 8, 96 2" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" opacity="0.55" />
      <path d="M130 60 C 120 45, 140 40, 132 25 C 126 14, 138 8, 136 2" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" opacity="0.4" />
    </g>
    <text x="110" y="78" text-anchor="middle" font-size="34" font-weight="700" fill="var(--accent)">?</text>
    <path d="M30 100 Q110 140 190 100 L182 118 Q110 150 38 118 Z" fill="var(--accent)" opacity="0.85" />
    <ellipse cx="110" cy="100" rx="80" ry="18" fill="none" stroke="var(--fg)" stroke-width="3" opacity="0.6" />
    <path d="M38 118 Q50 136 110 136 Q170 136 182 118" fill="none" stroke="var(--fg)" stroke-width="3" opacity="0.6" />
    <g transform="translate(150 118) rotate(25)">
      <circle cx="0" cy="0" r="16" fill="none" stroke="var(--fg)" stroke-width="4" opacity="0.7" />
      <line x1="11" y1="11" x2="28" y2="28" stroke="var(--fg)" stroke-width="5" stroke-linecap="round" opacity="0.7" />
    </g>
    <g transform="translate(30 140)" opacity="0.5">
      <ellipse cx="0" cy="6" rx="16" ry="9" fill="var(--fg)" />
      <circle cx="-13" cy="6" r="4" fill="var(--fg)" />
      <path d="M14 2 L24 -4 L22 6 Z" fill="var(--fg)" />
    </g>
  </svg>`;
}

function stepsHtml(): string {
  return `<ol class="how-it-works">
    <li>
      <span class="step-icon" aria-hidden="true">🥣</span>
      <h3>Read the 汤面 (the premise)</h3>
      <p>A short, strange scene — someone did something for a reason nobody's told you.</p>
    </li>
    <li>
      <span class="step-icon" aria-hidden="true">❓</span>
      <h3>Ask yes / no / irrelevant questions</h3>
      <p>The AI judge holds the full solution and answers every question honestly, one at a time.</p>
    </li>
    <li>
      <span class="step-icon" aria-hidden="true">🔎</span>
      <h3>Piece together the 汤底 (the truth)</h3>
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
      "Yes. Every case has one solution the AI judge holds from the start; a guess is judged against that solution, not against vibes.",
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
  return `<section class="faq">
    <h2>FAQ</h2>
    <dl>
      ${items
        .map(
          ([q, a]) => `<div class="faq-item">
        <dt>${escapeHtml(q)}</dt>
        <dd>${escapeHtml(a)}</dd>
      </div>`,
        )
        .join("\n")}
    </dl>
  </section>`;
}

function formatReasoningTime(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds} second${totalSeconds === 1 ? "" : "s"}`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export interface FeaturedPuzzle {
  id: string;
  title: string;
  premise: string;
}

function featuredCaseHtml(puzzle: FeaturedPuzzle): string {
  return `<li class="featured-card">
    <h3>${escapeHtml(puzzle.title)}</h3>
    <p>${escapeHtml(puzzle.premise)}</p>
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
      <div class="hero-copy">
        <h1>Turtle Soup Puzzle Room</h1>
        <p class="hero-tagline">One bowl of soup. One strange ending. The truth, found together.</p>
        <p class="hero-blurb">
          海龟汤 ("turtle soup") is a situational-reasoning game: start from a
          short, odd premise and ask yes / no / irrelevant questions until the
          room rebuilds the full truth behind it. Play alone, or open a room
          and let friends join with just a code.
        </p>
        <p class="content-warning" role="note">
          ⚠️ 部分故事包含恐怖 / 血腥元素，胆小慎入。
          (Some cases include horror or gory elements — read with care.)
        </p>
        <div class="hero-actions">
          <a href="/rooms/new" class="button-link">Start a new case</a>
          <form method="get" action="/join" class="join-form">
            <label for="join-code">Have a code?</label>
            <input type="text" id="join-code" name="code" maxlength="5" autocomplete="off" placeholder="ABCDE" />
            <button type="submit">Join</button>
          </form>
        </div>
      </div>
      ${bowlIllustration()}
    </section>

    <section class="stats-strip" aria-label="Site activity">
      <p class="reasoning-total" id="reasoning-total" data-reasoning-seconds="${reasoningSeconds}">
        🧠 <strong>${formatReasoningTime(reasoningSeconds)}</strong> of reasoning time logged across every room, together
      </p>
    </section>

    <section class="how-section">
      <h2>How it plays</h2>
      ${stepsHtml()}
    </section>

    <section class="lobby">
      <h2>Open cases</h2>
      <p class="lobby-empty" ${rooms.length ? "hidden" : ""}>No open cases right now — start one!</p>
      <ul class="lobby-list" id="lobby-list">
        ${rooms.map(caseCardHtml).join("\n")}
      </ul>
    </section>

    <section class="featured-cases">
      <h2>From the case library</h2>
      <p class="featured-blurb">A taste of the built-in cases waiting in the room-creation picker — the solution stays secret until someone solves it.</p>
      <ul class="featured-list">
        ${featuredPuzzles.map(featuredCaseHtml).join("\n")}
      </ul>
      <a href="/rooms/new" class="button-link-outline">Browse every case</a>
    </section>

    ${faqHtml()}
    <script src="/lobby.js"></script>
    `,
    profile,
  );
}
