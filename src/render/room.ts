import { formatAutoLabel, type Profile, type Puzzle, type QaEntry, type Room } from "../db.ts";
import type { Member } from "../sse.ts";
import { layout } from "./layout.ts";
import { escapeHtml } from "./html.ts";
import { asset } from "./asset.ts";
import { coverFor } from "./covers.ts";
import { QUESTION_MAX_LENGTH } from "../limits.ts";
import { JUDGE_DISPLAY_NAME, JUDGE_REPLY_TEXTS } from "../llm.ts";
import { entryAvatarUrl, WATSON_AVATAR } from "./avatars.ts";

const VERDICT_LABEL: Record<string, string> = {
  yes: "Yes",
  no: "No",
  irrelevant: "Irrelevant",
  correct: "✓ Correct!",
};

const KIND_BADGE: Record<"question" | "guess", string> = {
  question: "❓ Question",
  guess: "🎯 Final guess",
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
  const avatarImg = member.avatarUrl
    ? `<img src="${escapeHtml(member.avatarUrl)}" alt="" width="20" height="20" class="avatar-chip" /> `
    : "";
  return `<li>${avatarImg}${crown}${escapeHtml(member.label)}${transferButton}</li>`;
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

// Host-only link to the confirmation page (src/render/room-end.ts), never a
// direct POST from here — shown only while the case can still actually be
// ended (not already solved, not already closed), same terminal-state rule
// recapHtml/closedHtml below are each scoped to their own opposite state.
function endLinkHtml(room: Room): string {
  return `<p class="end-investigation"><a href="/rooms/${room.code}/end">End investigation</a></p>`;
}

function closedHtml(): string {
  return `<section class="closed-room">
    <p class="closed-banner">🛑 Investigation ended — unsolved. The host ended this case.</p>
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

// A system-kind entry is either a plain room notice ("host started the
// investigation") or the judge's own fixed reply to the question/guess entry
// right before it (src/routes/rooms.ts always inserts the verdict reply as
// its own row, by this app's existing design — no pairing column exists, and
// none is added here). JUDGE_REPLY_TEXTS lets the renderer tell the two
// apart by exact text match against the fixed sentences src/llm.ts can ever
// produce, purely to LABEL the row with the judge's player-facing display
// name (JUDGE_DISPLAY_NAME) instead of a bare notice — never to change
// what's stored, broadcast, or asserted on verdict value.
function systemEntryHtml(entry: QaEntry): string {
  const isJudgeReply = JUDGE_REPLY_TEXTS.has(entry.body);
  const label = isJudgeReply
    ? `<img src="${escapeHtml(WATSON_AVATAR)}" alt="" width="20" height="20" class="avatar-chip" /> <span class="entry-label">${escapeHtml(JUDGE_DISPLAY_NAME)}</span> `
    : "";
  return `<li class="entry entry-system${isJudgeReply ? " entry-judge-reply" : ""}" data-id="${entry.id}">${label}${escapeHtml(entry.body)}</li>`;
}

// A question/guess entry no longer repeats its own verdict inline (see
// entryHtml below) — the standalone judge-reply system row (inserted right
// after it by src/routes/rooms.ts, labeled by systemEntryHtml above) is now
// the ONLY place the verdict/result is shown, avoiding the exact duplicate
// a screenshot bug report flagged: "Your Partner, Watson: <verdict>" shown
// both inline in the player's own bubble AND again in a separate Watson
// bubble right below it.
//
// Some genuinely old rows predate that pairing being reliable: an early
// version of the judge (src/llm.ts, pre-Gemini) could return an empty-string
// `reply`, in which case src/routes/rooms.ts's `if (verdict.reply)` guard
// never inserted the system row at all — the verdict then exists ONLY on
// the question/guess entry itself, with nothing stored anywhere else. For
// exactly that case (checked by looking at the very next transcript row,
// matching how these two rows have always been inserted adjacently in
// order), this synthesizes a standalone Watson bubble from the old inline
// verdict so that answer isn't silently dropped — never for an entry that
// already has a real judge-reply row, so no new duplicates are introduced.
function hasJudgeReplyFollowing(transcript: QaEntry[], index: number): boolean {
  const next = transcript[index + 1];
  return !!next && next.kind === "system" && JUDGE_REPLY_TEXTS.has(next.body);
}

function synthesizedWatsonReplyHtml(entry: QaEntry): string {
  const verdictLabel = entry.verdict ? (VERDICT_LABEL[entry.verdict] ?? entry.verdict) : "…";
  return `<li class="entry entry-system entry-judge-reply entry-judge-reply-fallback" data-id="${entry.id}-watson-fallback">
    <img src="${escapeHtml(WATSON_AVATAR)}" alt="" width="20" height="20" class="avatar-chip" /> <span class="entry-label">${escapeHtml(JUDGE_DISPLAY_NAME)}</span> <strong>${escapeHtml(verdictLabel)}</strong>
  </li>`;
}

// Alignment is based on actual session ownership, read fresh per render —
// never a blanket "every other player is on the right," which would be
// actively misleading the moment a THIRD person's message showed up (whose
// is whose?). An entry whose author can't be compared to the viewer (a
// system/judge row, or one from before sessions were tracked) gets the
// neutral centered layout below instead of a guessed side.
function entryHtml(entry: QaEntry, viewerSessionId: string, transcript: QaEntry[], index: number): string {
  if (entry.kind === "system") {
    return systemEntryHtml(entry);
  }
  const own = entry.session_id !== null && entry.session_id === viewerSessionId;
  const sideClass = own ? " entry-own" : " entry-other";
  // Resolved from the ENTRY'S OWN author (entry.session_id), never the
  // viewer — entryAvatarUrl() returns null only for a system/judge row,
  // which never reaches this branch (handled above), so a real
  // question/guess entry always has a session_id here.
  const avatarUrl = entry.session_id ? entryAvatarUrl(entry) : null;
  // data-author-session-id lets public/client.js retarget this <img> live if
  // that session changes its avatar while this transcript is already on
  // screen (see sse.ts's updateAvatarForSession()) — never read as an
  // identity/trust signal, purely a DOM hook.
  const avatarImg = avatarUrl
    ? `<img src="${escapeHtml(avatarUrl)}" alt="" width="24" height="24" class="avatar-chip" data-author-session-id="${escapeHtml(entry.session_id ?? "")}" />`
    : "";
  const liHtml = `<li class="entry entry-${entry.kind}${sideClass}" data-id="${entry.id}">
    <p class="entry-meta">
      ${avatarImg}
      <span class="entry-label">${escapeHtml(entry.label ? formatAutoLabel(entry.label) : "Mystery Detective")}</span>
      <span class="entry-kind-badge">${KIND_BADGE[entry.kind]}</span>
    </p>
    <p class="entry-question">${escapeHtml(entry.body)}</p>
  </li>`;
  // Historical-fallback: only when this entry has a verdict but no
  // standalone judge-reply row follows it (see comment above
  // hasJudgeReplyFollowing) — never when a real judge-reply row already
  // exists, so nothing is duplicated for ordinary/current entries.
  if (entry.verdict && !hasJudgeReplyFollowing(transcript, index)) {
    return `${liHtml}\n${synthesizedWatsonReplyHtml(entry)}`;
  }
  return liHtml;
}

// Splits on a blank line (the only paragraph-break convention a puzzle's
// premise text actually uses — see src/db.ts's `premise TEXT NOT NULL`,
// stored as plain text with no markup) so the case-file sidebar can keep
// whatever paragraph breaks the author wrote, instead of the single
// escapeHtml()'d block this used to render as — never splits further than
// that, so a one-paragraph premise still renders as exactly one <p>, not
// invented "facts" or line-by-line fragments.
function premiseHtml(premise: string): string {
  return premise
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${escapeHtml(para)}</p>`)
    .join("\n");
}

function askFormHtml(room: Room, isAuthor: boolean): string {
  return `<form method="post" action="/rooms/${room.code}/ask" id="ask-form">
    <label for="question">Ask a yes/no question${isAuthor ? "" : ", or submit your final guess"}:</label>
    <textarea id="question" name="question" maxlength="${QUESTION_MAX_LENGTH}" required rows="2"></textarea>
    <p class="composer-hint">
      <span id="composer-counter">0 / ${QUESTION_MAX_LENGTH}</span>
      <span class="composer-keys">Enter for a new line · Ctrl+Enter (or ⌘+Enter) to ask</span>
    </p>
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
  const closed = Boolean(room.closed_at);
  const waiting = room.status === "waiting" && !closed;
  // "Terminal" = nothing can change this room's outcome anymore — a solved
  // room (recapHtml) or a host-closed one (closedHtml) — so the ask form and
  // every start/transfer/end control are all gated on this one flag rather
  // than repeating the solved-or-closed check at each control.
  const terminal = solved || closed;
  const heading = room.name ? escapeHtml(room.name) : `Case #${room.code}`;

  return layout(
    `${room.name ?? `Case ${room.code}`} · Turtle Soup Puzzle Room`,
    `
    <section class="room" data-room-code="${room.code}" data-room-status="${room.status}" data-last-id="${transcript.at(-1)?.id ?? 0}" data-solved="${solved}" data-closed="${closed}" data-host-session-id="${escapeHtml(room.host_session_id ?? "")}" data-viewer-session-id="${escapeHtml(viewerSessionId)}" data-is-host="${isHost}">
      <header class="room-header">
        <h1>${heading}</h1>
        <div class="room-header-row">
          <p class="room-subtitle">
            playing <strong>${escapeHtml(puzzle.title)}</strong>
            · <span class="room-code">Code: <code id="room-code-value">${room.code}</code></span>
          </p>
          <div class="share-row">
            <button type="button" class="share-button" id="copy-code-button" data-code="${room.code}">Copy code</button>
            <button type="button" class="share-button" id="copy-link-button">Copy room link</button>
            <span class="share-feedback" id="share-feedback" role="status" aria-live="polite"></span>
          </div>
          <p class="online-count" id="online-count">${onlineLabel(onlineCount)}</p>
        </div>
        <p class="connection-status" id="connection-status" role="status" aria-live="polite" hidden></p>
        ${notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : ""}
      </header>

      <details class="case-file" id="case-file" open>
        <summary class="case-file-summary">Case file</summary>
        <div class="case-file-body">
          <div class="room-cover">
            <img src="${coverFor(puzzle.slug, puzzle.id, puzzle.cover_path)}" alt="" width="800" height="500" loading="lazy" decoding="async" />
          </div>
          <p class="case-eyebrow">Case file / The Scene</p>
          <h2 class="case-title">${escapeHtml(puzzle.title)}</h2>
          <div class="premise">${premiseHtml(puzzle.premise)}</div>
          <p class="whoami">You are <strong>${escapeHtml(label)}</strong></p>
          ${membersHtml(members, room, isHost && !terminal)}
          ${isHost && !terminal ? endLinkHtml(room) : ""}
        </div>
      </details>

      <div class="room-main">
        <h2 class="conversation-heading">Conversation</h2>
        ${solved ? recapHtml(room, puzzle, transcript, participants) : ""}
        ${closed ? closedHtml() : ""}
        ${waiting ? waitingHtml(room, isHost) : ""}
        <p class="judging" id="judging-status" role="status" hidden></p>

        <ul class="transcript" id="transcript">
          ${transcript.map((e, i) => entryHtml(e, viewerSessionId, transcript, i)).join("\n")}
        </ul>

        ${terminal || waiting ? "" : askFormHtml(room, isAuthor)}
      </div>
    </section>
    <script id="initial-transcript" type="application/json">${JSON.stringify(transcript)}</script>
    <script src="${asset("/client.js")}"></script>
    `,
    profile,
  );
}
