import type { LobbyRoom, Profile } from "../db.ts";
import { layout } from "./layout.ts";
import { escapeHtml } from "./html.ts";

export interface LobbyCardRoom extends LobbyRoom {
  players: number;
}

function statusLabel(started: boolean): string {
  return started ? "🔎 In progress" : "🆕 Not started yet";
}

function caseCardHtml(room: LobbyCardRoom): string {
  return `<li class="case-card" data-code="${room.code}">
    <div class="case-card-main">
      <h3>${escapeHtml(room.title)}</h3>
      <p class="case-card-meta">
        <span class="case-code">Code: <code>${room.code}</code></span>
        <span class="case-status">${statusLabel(room.started)}</span>
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
      <h1>Turtle Soup Puzzle Room</h1>
      <p>
        The AI knows the whole truth, and only ever gives you one cryptic premise.
        Everyone in the room shares the same transcript — ask yes/no questions,
        the AI rules on them in real time, and the answer broadcasts live to
        everyone in the room. Reason together, solve the case together.
      </p>
      <div class="hero-actions">
        <form method="post" action="/rooms">
          <button type="submit">Start a new case</button>
        </form>
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
