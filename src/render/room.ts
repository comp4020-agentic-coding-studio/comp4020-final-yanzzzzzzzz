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
  yes: "是",
  no: "否",
  irrelevant: "无关",
  correct: "✓ 正确！",
};

function entryHtml(entry: QaEntry): string {
  if (entry.kind === "system") {
    return `<li class="entry entry-system">${escapeHtml(entry.body)}</li>`;
  }
  const verdictLabel = entry.verdict ? (VERDICT_LABEL[entry.verdict] ?? entry.verdict) : "……";
  return `<li class="entry entry-${entry.kind}" data-id="${entry.id}">
    <p class="entry-question"><span class="entry-label">${escapeHtml(entry.label ?? "匿名侦探")}</span> 问：${escapeHtml(entry.body)}</p>
    <p class="entry-verdict">AI 裁判：<strong>${escapeHtml(verdictLabel)}</strong></p>
  </li>`;
}

export function roomPage(args: {
  room: Room;
  puzzle: Puzzle;
  transcript: QaEntry[];
  label: string;
  notice?: string;
}): string {
  const { room, puzzle, transcript, label, notice } = args;
  const solved = room.status === "solved";

  return layout(
    `案件 ${room.code} · 海龟汤协作解谜室`,
    `
    <section class="room" data-room-code="${room.code}" data-last-id="${transcript.at(-1)?.id ?? 0}" data-solved="${solved}">
      <h1>案件编号：${room.code}</h1>
      <p class="premise">${escapeHtml(puzzle.premise)}</p>
      ${
        solved
          ? `<p class="solved-banner">🎉 案件已侦破！真相：${escapeHtml(puzzle.solution)}</p>`
          : ""
      }
      <p class="whoami">你是 <strong>${escapeHtml(label)}</strong></p>
      ${notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : ""}

      <ul class="transcript" id="transcript">
        ${transcript.map(entryHtml).join("\n")}
      </ul>

      ${
        solved
          ? ""
          : `<form method="post" action="/rooms/${room.code}/ask" id="ask-form">
        <label for="question">提出一个是/否问题，或直接说出你的最终猜测：</label>
        <input type="text" id="question" name="question" maxlength="200" required autocomplete="off" />
        <button type="submit">提问</button>
      </form>`
      }
    </section>
    <script id="initial-transcript" type="application/json">${JSON.stringify(transcript)}</script>
    <script src="/client.js"></script>
    `,
  );
}
