import type { Profile, Puzzle, QaEntry, Room } from "../db.ts";
import type { Member } from "../sse.ts";
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

function memberRowHtml(member: Member, room: Room, viewerIsHost: boolean): string {
  const isHost = member.sessionId === room.host_session_id;
  const crown = isHost ? `<span class="host-badge" title="Host">👑</span> ` : "";
  const transferButton =
    viewerIsHost && !isHost
      ? `<form method="post" action="/rooms/${room.code}/transfer-host" class="transfer-host-form">
          <input type="hidden" name="toSessionId" value="${escapeHtml(member.sessionId)}" />
          <button type="submit" class="transfer-host-button">Make host</button>
        </form>`
      : "";
  return `<li>${crown}${escapeHtml(member.label)}${transferButton}</li>`;
}

function membersHtml(members: Member[], room: Room, viewerIsHost: boolean): string {
  return `<ul class="members" id="members">
    ${members.map((m) => memberRowHtml(m, room, viewerIsHost)).join("\n")}
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

function waitingHtml(room: Room, isHost: boolean): string {
  return `<section class="waiting-room">
    ${
      isHost
        ? `<form method="post" action="/rooms/${room.code}/start">
          <button type="submit">🚦 Start the investigation</button>
        </form>`
        : `<p class="notice" role="status">Waiting for the host to start this case…</p>`
    }
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

function askFormHtml(room: Room, isAuthor: boolean): string {
  return `<form method="post" action="/rooms/${room.code}/ask" id="ask-form">
    <label for="question">Ask a yes/no question${isAuthor ? "" : ", or submit your final guess"}:</label>
    <input type="text" id="question" name="question" maxlength="200" required autocomplete="off" />
    <div class="ask-buttons">
      <button type="submit" name="kind" value="question">Ask</button>
      ${
        isAuthor
          ? ""
          : `<button type="submit" name="kind" value="guess" class="guess-button">Submit final guess</button>`
      }
    </div>
    ${isAuthor ? `<p class="author-note">You wrote this case, so your own guesses don't count.</p>` : ""}
    <p class="notice" id="ask-notice" role="status" hidden></p>
  </form>`;
}

export function roomPage(args: {
  room: Room;
  puzzle: Puzzle;
  transcript: QaEntry[];
  label: string;
  notice?: string;
  onlineCount: number;
  members: Member[];
  profile: Profile;
  participants: number;
  viewerSessionId: string;
  isHost: boolean;
  isAuthor: boolean;
}): string {
  const {
    room,
    puzzle,
    transcript,
    label,
    notice,
    onlineCount,
    members,
    profile,
    participants,
    viewerSessionId,
    isHost,
    isAuthor,
  } = args;
  const solved = room.status === "solved";
  const waiting = room.status === "waiting";
  const heading = room.name ? escapeHtml(room.name) : `Case #${room.code}`;

  return layout(
    `${room.name ?? `Case ${room.code}`} · Turtle Soup Puzzle Room`,
    `
    <section class="room" data-room-code="${room.code}" data-room-status="${room.status}" data-last-id="${transcript.at(-1)?.id ?? 0}" data-solved="${solved}" data-host-session-id="${escapeHtml(room.host_session_id ?? "")}" data-viewer-session-id="${escapeHtml(viewerSessionId)}" data-is-host="${isHost}">
      <div class="room-main">
        <h1>${heading}</h1>
        <p class="room-subtitle">
          playing <strong>${escapeHtml(puzzle.title)}</strong>
          · <span class="room-code">Code: <code id="room-code-value">${room.code}</code></span>
        </p>
        <div class="share-row">
          <button type="button" class="share-button" id="copy-code-button" data-code="${room.code}">Copy code</button>
          <button type="button" class="share-button" id="copy-link-button">Copy room link</button>
          <span class="share-feedback" id="share-feedback" role="status" aria-live="polite"></span>
        </div>
        <p class="premise">${escapeHtml(puzzle.premise)}</p>
        <p class="connection-status" id="connection-status" role="status" aria-live="polite" hidden></p>
        ${solved ? recapHtml(room, puzzle, transcript, participants) : ""}
        ${waiting ? waitingHtml(room, isHost) : ""}
        ${notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : ""}
        <p class="judging" id="judging-status" role="status" hidden></p>

        <ul class="transcript" id="transcript">
          ${transcript.map(entryHtml).join("\n")}
        </ul>

        ${solved || waiting ? "" : askFormHtml(room, isAuthor)}
      </div>
      <aside class="room-sidebar">
        <p class="whoami">You are <strong>${escapeHtml(label)}</strong></p>
        <p class="online-count" id="online-count">${onlineLabel(onlineCount)}</p>
        ${membersHtml(members, room, isHost)}
      </aside>
    </section>
    <script id="initial-transcript" type="application/json">${JSON.stringify(transcript)}</script>
    <script src="/client.js"></script>
    `,
    profile,
  );
}
