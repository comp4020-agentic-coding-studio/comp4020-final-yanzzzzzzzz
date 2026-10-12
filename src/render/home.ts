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

export function homePage(args: { rooms: LobbyCardRoom[]; profile: Profile }): string {
  const { rooms, profile } = args;
  return layout(
    "Turtle Soup Puzzle Room",
    `
    <section class="hero">
      <div class="hero-intro">
        <h1>Turtle Soup Puzzle Room</h1>
        <p>Multiplayer, AI-judged lateral-thinking cases, solved live together.</p>
      </div>
      <div class="hero-actions">
        <a href="/rooms/new" class="button-link">Start a new case</a>
        <form method="get" action="/join" class="join-form">
          <label for="join-code">Have a code?</label>
          <input type="text" id="join-code" name="code" maxlength="5" autocomplete="off" placeholder="ABCDE" />
          <button type="submit">Join</button>
        </form>
      </div>
    </section>

    <section class="lobby">
      <h2>Open cases</h2>
      <p class="lobby-empty" ${rooms.length ? "hidden" : ""}>No open cases right now — start one!</p>
      <ul class="lobby-list" id="lobby-list">
        ${rooms.map(caseCardHtml).join("\n")}
      </ul>
    </section>
    <script src="/lobby.js"></script>
    `,
    profile,
  );
}
