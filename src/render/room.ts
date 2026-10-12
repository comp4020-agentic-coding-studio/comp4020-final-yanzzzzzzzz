import type { Profile, Puzzle, QaEntry, Room } from "../db.ts";
import { layout } from "./layout.ts";
import { escapeHtml } from "./html.ts";

const VERDICT_LABEL: Record<string, string> = {
  yes: "Yes",
  no: "No",
  irrelevant: "Irrelevant",
  correct: "✓ Correct!",
};

function onlineLabel(online: number): string {
  return `👥 ${online} ${online === 1 ? "person" : "people"} online`;
}

function membersHtml(members: string[]): string {
  return `<ul class="members" id="members">
    ${members.map((m) => `<li>${escapeHtml(m)}</li>`).join("\n")}
  </ul>`;
}

// Room timestamps come back from SQLite as "YYYY-MM-DD HH:MM:SS" in UTC with
// no zone marker — the same shape rooms.ts's cooldown check already parses.
function parseSqliteTime(s: string): number {
  return Date.parse(`${s.replace(" ", "T")}Z`);
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`;
}

function recapHtml(room: Room, puzzle: Puzzle, transcript: QaEntry[], participants: number): string {
  const askedCount = transcript.filter((e) => e.kind === "question" || e.kind === "guess").length;
  const solvedEntry = transcript.find((e) => e.verdict === "correct");
  const duration = solvedEntry
    ? formatDuration(parseSqliteTime(solvedEntry.created_at) - parseSqliteTime(room.created_at))
    : null;

  return `<section class="recap">
    <p class="solved-banner">🎉 Case solved! The truth: ${escapeHtml(puzzle.solution)}</p>
    <p class="recap-stats">
      <span>❓ ${askedCount} question${askedCount === 1 ? "" : "s"} asked</span>
      <span>👥 ${participants} participant${participants === 1 ? "" : "s"}</span>
      ${duration ? `<span>⏱️ solved in ${duration}</span>` : ""}
    </p>
    <div class="recap-actions">
      <form method="post" action="/rooms"><button type="submit">Play again</button></form>
      <a href="/" class="recap-lobby">Back to lobby</a>
    </div>
  </section>`;
}

function entryHtml(entry: QaEntry): string {
  if (entry.kind === "system") {
    return `<li class="entry entry-system">${escapeHtml(entry.body)}</li>`;
  }
  const verdictLabel = entry.verdict ? (VERDICT_LABEL[entry.verdict] ?? entry.verdict) : "…";
  const verb = entry.kind === "guess" ? "guesses" : "asks";
  return `<li class="entry entry-${entry.kind}" data-id="${entry.id}">
    <p class="entry-question"><span class="entry-label">${escapeHtml(entry.label ?? "Anonymous Detective")}</span> ${verb}: ${escapeHtml(entry.body)}</p>
    <p class="entry-verdict">AI judge: <strong>${escapeHtml(verdictLabel)}</strong></p>
  </li>`;
}

export function roomPage(args: {
  room: Room;
  puzzle: Puzzle;
  transcript: QaEntry[];
  label: string;
  notice?: string;
  onlineCount: number;
  members: string[];
  profile: Profile;
  participants: number;
}): string {
  const { room, puzzle, transcript, label, notice, onlineCount, members, profile, participants } =
    args;
  const solved = room.status === "solved";

  return layout(
    `Case ${room.code} · Turtle Soup Puzzle Room`,
    `
    <section class="room" data-room-code="${room.code}" data-last-id="${transcript.at(-1)?.id ?? 0}" data-solved="${solved}">
      <h1>Case #${room.code}</h1>
      <p class="premise">${escapeHtml(puzzle.premise)}</p>
      ${solved ? recapHtml(room, puzzle, transcript, participants) : ""}
      <p class="whoami">You are <strong>${escapeHtml(label)}</strong></p>
      <p class="online-count" id="online-count">${onlineLabel(onlineCount)}</p>
      ${membersHtml(members)}
      ${notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : ""}
      <p class="judging" id="judging-status" role="status" hidden></p>

      <ul class="transcript" id="transcript">
        ${transcript.map(entryHtml).join("\n")}
      </ul>

      ${
        solved
          ? ""
          : `<form method="post" action="/rooms/${room.code}/ask" id="ask-form">
        <label for="question">Ask a yes/no question, or submit your final guess:</label>
        <input type="text" id="question" name="question" maxlength="200" required autocomplete="off" />
        <div class="ask-buttons">
          <button type="submit" name="kind" value="question">Ask</button>
          <button type="submit" name="kind" value="guess" class="guess-button">Submit final guess</button>
        </div>
      </form>`
      }
    </section>
    <script id="initial-transcript" type="application/json">${JSON.stringify(transcript)}</script>
    <script src="/client.js"></script>
    `,
    profile,
  );
}
