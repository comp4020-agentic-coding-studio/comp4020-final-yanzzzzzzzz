import type { Puzzle, QaEntry, Room } from "../db.ts";
import { layout } from "./layout.ts";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const VERDICT_LABEL: Record<string, string> = {
  yes: "Yes",
  no: "No",
  irrelevant: "Irrelevant",
  correct: "✓ Correct!",
};

function onlineLabel(online: number): string {
  return `👥 ${online} ${online === 1 ? "person" : "people"} online`;
}

function entryHtml(entry: QaEntry): string {
  if (entry.kind === "system") {
    return `<li class="entry entry-system">${escapeHtml(entry.body)}</li>`;
  }
  const verdictLabel = entry.verdict ? (VERDICT_LABEL[entry.verdict] ?? entry.verdict) : "…";
  return `<li class="entry entry-${entry.kind}" data-id="${entry.id}">
    <p class="entry-question"><span class="entry-label">${escapeHtml(entry.label ?? "Anonymous Detective")}</span> asks: ${escapeHtml(entry.body)}</p>
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
}): string {
  const { room, puzzle, transcript, label, notice, onlineCount } = args;
  const solved = room.status === "solved";

  return layout(
    `Case ${room.code} · Turtle Soup Puzzle Room`,
    `
    <section class="room" data-room-code="${room.code}" data-last-id="${transcript.at(-1)?.id ?? 0}" data-solved="${solved}">
      <h1>Case #${room.code}</h1>
      <p class="premise">${escapeHtml(puzzle.premise)}</p>
      ${
        solved
          ? `<p class="solved-banner">🎉 Case solved! The truth: ${escapeHtml(puzzle.solution)}</p>`
          : ""
      }
      <p class="whoami">You are <strong>${escapeHtml(label)}</strong></p>
      <p class="online-count" id="online-count">${onlineLabel(onlineCount)}</p>
      ${notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : ""}

      <ul class="transcript" id="transcript">
        ${transcript.map(entryHtml).join("\n")}
      </ul>

      ${
        solved
          ? ""
          : `<form method="post" action="/rooms/${room.code}/ask" id="ask-form">
        <label for="question">Ask a yes/no question, or state your final guess:</label>
        <input type="text" id="question" name="question" maxlength="200" required autocomplete="off" />
        <button type="submit">Ask</button>
      </form>`
      }
    </section>
    <script id="initial-transcript" type="application/json">${JSON.stringify(transcript)}</script>
    <script src="/client.js"></script>
    `,
  );
}
