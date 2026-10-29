import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { multipartBodyLimit } from "../body-limit.ts";
import {
  canViewPuzzleCover,
  countParticipants,
  createAuthoredPuzzle,
  createRoom,
  displayLabel,
  getListedRoomCoverPath,
  getProfile,
  getPuzzle,
  getRoomByCode,
  getTranscript,
  hostLabel,
  insertEntry,
  isParticipant,
  isPuzzleAvailable,
  lastQuestionAt,
  listAvailablePuzzles,
  markSolved,
  pickRandomPuzzle,
  recordHeartbeat,
  startRoom,
  transferHost,
} from "../db.ts";
import { JUDGE_FAILURE_MESSAGES, judge, judgeAvailability } from "../llm.ts";
import { QUESTION_MAX_LENGTH } from "../limits.ts";
import { tryLockRoom, unlockRoom } from "../room-lock.ts";
import { broadcast, connectionCount, listMembers, subscribe } from "../sse.ts";
import { getOrCreateSessionId } from "../session.ts";
import { roomPage } from "../render/room.ts";
import { newRoomPage } from "../render/room-new.ts";
import { roomNotFoundPage } from "../render/not-found.ts";
import { broadcastLobbyCardChange, LOBBY_CHANNEL } from "./lobby.ts";
import { isSameOrigin } from "../same-origin.ts";
import { coverFilePath, coverRejectionMessage, deleteCover, processCoverUpload } from "../uploads.ts";
import { coverForRoom } from "../render/covers.ts";
import { avatarForSession, entryAvatarUrl } from "../render/avatars.ts";
import { readFile } from "node:fs/promises";

const COOLDOWN_MS = 5_000;

const NOTICES: Record<string, string> = {
  cooldown: "Slow down — the same person has to wait a few seconds between questions.",
  busy: "Someone else in this room just asked — wait a moment and try again.",
  "host-only": "Only the host can do that.",
  "not-started": "This case hasn't started yet — wait for the host.",
  "author-guess": "You wrote this case — let someone else crack it.",
  "too-long": `That's too long — keep it under ${QUESTION_MAX_LENGTH} characters.`,
  "unavailable-puzzle": "That puzzle isn't available to pick anymore.",
  "incomplete-puzzle": "Fill in a title, premise, and solution to create your case.",
  "cover-too-large": "That request was too large — the cover image limit is 2 MiB.",
  "too-large": coverRejectionMessage("too-large"),
  "unsupported-format": coverRejectionMessage("unsupported-format"),
  corrupt: coverRejectionMessage("corrupt"),
  "pixel-limit": coverRejectionMessage("pixel-limit"),
};

// A single room-creation POST carries the cover file plus every text field
// (title/premise/solution/name), so the body-size cap has to cover all of
// it — 3 MiB total leaves comfortable room above the 2 MiB per-file cover
// limit (src/uploads.ts) for the text fields and multipart framing
// overhead, while still being small relative to this deploy's 256 MB RAM
// budget. Applied only to this one route (not globally) since no other
// POST on this app accepts a file.
const ROOM_CREATE_BODY_LIMIT_BYTES = 3 * 1024 * 1024;

export const rooms = new Hono();

rooms.get("/rooms/new", (c) => {
  const profile = getProfile(getOrCreateSessionId(c));
  const mode = c.req.query("mode") === "author" ? "author" : "existing";
  const notice = NOTICES[c.req.query("notice") ?? ""];
  // A ?puzzleId= only ever pre-selects a puzzle already on the public list —
  // isPuzzleAvailable() is the same shared/built-in visibility check POST
  // /rooms enforces, so an invalid or private id just falls back to no
  // selection rather than preselecting (and thereby revealing the existence
  // of) a puzzle the requester shouldn't see.
  const requestedPuzzleId = c.req.query("puzzleId");
  const selectedPuzzleId =
    requestedPuzzleId && isPuzzleAvailable(requestedPuzzleId) ? requestedPuzzleId : undefined;
  return c.html(
    newRoomPage({ mode, puzzles: listAvailablePuzzles(), profile, notice, selectedPuzzleId }),
  );
});

rooms.post(
  "/rooms",
  multipartBodyLimit(ROOM_CREATE_BODY_LIMIT_BYTES, "/rooms/new?mode=author&notice=cover-too-large"),
  async (c) => {
  const sessionId = getOrCreateSessionId(c);
  const body = await c.req.parseBody();
  const mode = body.mode === "author" ? "author" : "existing";
  const name = String(body.name ?? "").trim().slice(0, 60) || null;

  let puzzle;
  if (mode === "author") {
    const title = String(body.title ?? "").trim().slice(0, 80);
    const premise = String(body.premise ?? "").trim().slice(0, 1000);
    const solution = String(body.solution ?? "").trim().slice(0, 2000);
    if (!title || !premise || !solution) {
      return c.redirect("/rooms/new?mode=author&notice=incomplete-puzzle", 303);
    }

    // A <form> field that was never touched (no file input present at all,
    // or the form didn't include one) comes back from parseBody() as a
    // plain string. But a real browser's <input type="file"> with NOTHING
    // selected still submits the field — as a File with name "" and size 0
    // (reproduced against Node's own multipart parser, not assumed) — so
    // "the field is a File" alone is NOT a reliable no-cover check. Only
    // that exact empty-sentinel shape means "no file chosen"; any File with
    // a real filename (including a genuinely empty 0-byte upload, which a
    // user could actually pick) still goes through processCoverUpload and
    // gets a proper too-small/corrupt rejection, never a silent skip.
    const isEmptyFileSentinel =
      body.cover instanceof File && body.cover.name === "" && body.cover.size === 0;
    let coverPath: string | null = null;
    if (body.cover instanceof File && !isEmptyFileSentinel) {
      const result = await processCoverUpload(body.cover);
      if (!result.ok) {
        return c.redirect(`/rooms/new?mode=author&notice=${result.reason}`, 303);
      }
      coverPath = result.coverPath;
    }

    const shared = body.shared === "on";
    try {
      puzzle = createAuthoredPuzzle({
        title,
        premise,
        solution,
        authorSessionId: sessionId,
        shared,
        coverPath,
      });
    } catch (err) {
      // The puzzle row failed to insert after a cover was already written —
      // never leave an orphaned file under uploads/covers with no row
      // pointing at it.
      if (coverPath) deleteCover(coverPath);
      throw err;
    }
  } else {
    const puzzleId = typeof body.puzzleId === "string" ? body.puzzleId : "";
    if (puzzleId) {
      if (!isPuzzleAvailable(puzzleId)) {
        return c.redirect("/rooms/new?notice=unavailable-puzzle", 303);
      }
      const found = getPuzzle(puzzleId);
      if (!found) return c.redirect("/rooms/new?notice=unavailable-puzzle", 303);
      puzzle = found;
    } else {
      // No explicit pick (a bare "start a case" with nothing chosen yet) —
      // still only ever lands on a shared/built-in puzzle, same rule as a
      // client-supplied id, never a private authored one.
      puzzle = pickRandomPuzzle();
    }
  }

  const room = createRoom(puzzle.id, { name, hostSessionId: sessionId });
  // Nobody's connected yet, so 0 players is the true count, not a
  // placeholder — and every room starts 'waiting' until its host starts it.
  // Same "lobby-update" event (and payload shape) as broadcastLobbyCardChange
  // uses for a status/host change — public/lobby.js has one upsert handler
  // for both "a new card" and "an existing card changed," not two.
  broadcast(
    LOBBY_CHANNEL,
    room.id,
    {
      code: room.code,
      name: room.name,
      title: puzzle.title,
      status: room.status,
      players: 0,
      hostLabel: hostLabel(sessionId),
      coverUrl: coverForRoom(puzzle.slug, room.code, puzzle.cover_path),
    },
    "lobby-update",
  );
  return c.redirect(`/rooms/${room.code}`, 303);
  },
);

// Serves a player-authored case's uploaded cover — deliberately NOT a
// static file under /public (which serveStatic would expose to anyone, no
// matter the puzzle's own shared/private visibility), and deliberately not
// exposing OUTPUT_DIR as a listable/traversable directory: this route only
// ever reads the exact filename stored in puzzles.cover_path for the
// puzzle id in the URL, through canViewPuzzleCover()'s own access check —
// the puzzle's author, anyone who already joined a room playing it, or
// anyone at all if the puzzle is shared/public. A guess-the-id private
// cover request gets the same 404 as a nonexistent one, not a 403 that
// would itself confirm the id exists.
rooms.get("/uploads/cover/:puzzleId", async (c) => {
  const puzzleId = c.req.param("puzzleId");
  const puzzle = getPuzzle(puzzleId);
  if (!puzzle || !puzzle.cover_path) return c.notFound();

  const sessionId = getOrCreateSessionId(c);
  if (!canViewPuzzleCover(puzzleId, sessionId)) return c.notFound();

  let fileBytes;
  try {
    fileBytes = await readFile(coverFilePath(puzzle.cover_path));
  } catch {
    return c.notFound();
  }
  c.header("Content-Type", "image/webp");
  c.header("X-Content-Type-Options", "nosniff");
  // Covers are re-encoded once at upload time and never modified afterward
  // (no "edit my case" route exists) — safe to cache for a long time
  // without a cache-busting query string, since the URL itself (the
  // puzzle's own id) never points at different bytes over time.
  c.header("Cache-Control", "private, max-age=86400");
  return c.body(fileBytes);
});

// The lobby/home room-card thumbnail for a player-uploaded cover —
// deliberately NOT routed through canViewPuzzleCover() (which requires
// having already joined the room, or the puzzle being shared/public), since
// a lobby card is shown to people who haven't joined yet and a private
// authored puzzle's room is still legitimately listed. Scoped instead to
// "this room is currently listed" (getListedRoomCoverPath(), src/db.ts) —
// the same status filter the lobby list itself uses — so this route serves
// exactly the one image a lobby viewer can already see is attached to a
// publicly-browsable room, never anything about a puzzle that isn't
// actually listed anywhere. No caching headers reveal whether a code is
// real vs solved/nonexistent beyond the 404 itself, same as the room page.
rooms.get("/rooms/:code/cover", async (c) => {
  const code = c.req.param("code");
  const coverPath = getListedRoomCoverPath(code);
  if (!coverPath) return c.notFound();

  let fileBytes;
  try {
    fileBytes = await readFile(coverFilePath(coverPath));
  } catch {
    return c.notFound();
  }
  c.header("Content-Type", "image/webp");
  c.header("X-Content-Type-Options", "nosniff");
  // Short cache, unlike the puzzle-id-keyed upload route: once this room is
  // solved/delisted, getListedRoomCoverPath() starts returning null and this
  // same URL 404s — a long cache would keep serving a stale 200 for an
  // image that should disappear from the lobby promptly, not up to a day
  // later.
  c.header("Cache-Control", "private, max-age=60");
  return c.body(fileBytes);
});

rooms.get("/join", (c) => {
  const code = c.req.query("code")?.trim().toUpperCase();
  if (!code) return c.redirect("/");
  return c.redirect(`/rooms/${code}`, 303);
});

rooms.get("/rooms/:code", (c) => {
  const code = c.req.param("code");
  const room = getRoomByCode(code);
  if (!room) {
    const profile = getProfile(getOrCreateSessionId(c));
    return c.html(roomNotFoundPage(code, profile), 404);
  }
  const puzzle = getPuzzle(room.puzzle_id);
  if (!puzzle) {
    const profile = getProfile(getOrCreateSessionId(c));
    return c.html(roomNotFoundPage(code, profile), 404);
  }

  const sessionId = getOrCreateSessionId(c);
  const label = displayLabel(room.id, sessionId);
  const profile = getProfile(sessionId);
  const transcript = getTranscript(room.id);
  const notice = NOTICES[c.req.query("notice") ?? ""];

  const onlineCount = connectionCount(room.id);
  const members = listMembers(room.id);
  const participants = countParticipants(room.id);
  const isHost = sessionId === room.host_session_id;
  const isAuthor = puzzle.author_session_id === sessionId;

  return c.html(
    roomPage({
      room,
      puzzle,
      transcript,
      label,
      notice,
      onlineCount,
      members,
      profile,
      participants,
      viewerSessionId: sessionId,
      isHost,
      isAuthor,
    }),
  );
});

// Every other viewer already sitting on this room's page (someone else just
// started it, or just transferred host) learns about it through this, not a
// manual refresh — found missing when a user reported "the other side's
// input box doesn't become usable after I start the case." Root cause:
// starting a room or transferring host only ever redirected the REQUESTING
// session; nothing was ever broadcast on the room's SSE channel, so a tab
// that was already open and wasn't the one that just POSTed had no way to
// learn the room's status/host changed. public/client.js's "room-status"
// listener reacts by reloading, the simplest correct way to pick up the
// now-different waiting/active markup (the ask-form's presence, the waiting
// notice, the host badge) without duplicating every render branch in JS.
rooms.post("/rooms/:code/start", (c) => {
  const room = getRoomByCode(c.req.param("code"));
  if (!room) return c.notFound();
  const sessionId = getOrCreateSessionId(c);
  if (sessionId !== room.host_session_id) {
    return c.redirect(`/rooms/${room.code}?notice=host-only`, 303);
  }
  if (room.status === "waiting") {
    startRoom(room.id);
    // Not displayLabel(): starting the room shouldn't itself register the
    // host as a numbered participant if they haven't actually joined yet.
    const entry = insertEntry({
      roomId: room.id,
      sessionId: null,
      kind: "system",
      body: "🚦 The host started the investigation.",
      verdict: null,
      label: null,
    });
    broadcast(room.id, entry.id, { ...entry, avatarUrl: entryAvatarUrl(entry) });
    broadcast(
      room.id,
      Date.now(),
      { status: "active", hostSessionId: room.host_session_id },
      "room-status",
    );
    // The lobby's own card for this room shows "not started" / "in
    // progress" — a viewer sitting on the homepage while this room starts
    // sees that flip live too, not just someone sitting on the room page.
    broadcastLobbyCardChange(room.id, room.code);
  }
  return c.redirect(`/rooms/${room.code}`, 303);
});

rooms.post("/rooms/:code/transfer-host", async (c) => {
  const room = getRoomByCode(c.req.param("code"));
  if (!room) return c.notFound();
  const sessionId = getOrCreateSessionId(c);
  if (sessionId !== room.host_session_id) {
    return c.redirect(`/rooms/${room.code}?notice=host-only`, 303);
  }
  const body = await c.req.parseBody();
  const toSessionId = String(body.toSessionId ?? "");
  if (toSessionId && toSessionId !== sessionId && isParticipant(room.id, toSessionId)) {
    transferHost(room.id, toSessionId);
    broadcast(
      room.id,
      Date.now(),
      { status: room.status, hostSessionId: toSessionId },
      "room-status",
    );
    broadcastLobbyCardChange(room.id, room.code);
  }
  return c.redirect(`/rooms/${room.code}`, 303);
});

rooms.post("/rooms/:code/ask", async (c) => {
  const room = getRoomByCode(c.req.param("code"));
  if (!room) return c.notFound();
  if (room.status === "solved") return c.redirect(`/rooms/${room.code}`, 303);
  if (room.status === "waiting") {
    return c.redirect(`/rooms/${room.code}?notice=not-started`, 303);
  }

  const puzzle = getPuzzle(room.puzzle_id);
  if (!puzzle) return c.notFound();

  const sessionId = getOrCreateSessionId(c);
  const label = displayLabel(room.id, sessionId);

  const body = await c.req.parseBody();
  const question = String(body.question ?? "").trim();
  if (!question) return c.redirect(`/rooms/${room.code}`, 303);
  // Rejected outright, never silently sliced: a final explanation that runs
  // past the limit used to get truncated server-side with no signal at all,
  // so the judge would score whatever happened to survive the cut — a wrong
  // verdict caused by this app's own input box, not the player's reasoning
  // (see PROCESS.md's "a longer, more complete guess ... silently clipped"
  // entry). An explicit notice plus the client keeping the player's full
  // draft (public/client.js never clears the textarea on a rejection) means
  // the player can see why it bounced and retry with the same text, not
  // re-type it from a mangled remnant.
  if (question.length > QUESTION_MAX_LENGTH) {
    return c.redirect(`/rooms/${room.code}?notice=too-long`, 303);
  }
  const kind: "question" | "guess" = body.kind === "guess" ? "guess" : "question";

  if (kind === "guess" && puzzle.author_session_id === sessionId) {
    return c.redirect(`/rooms/${room.code}?notice=author-guess`, 303);
  }

  const last = lastQuestionAt(room.id, sessionId);
  if (last) {
    const lastMs = Date.parse(`${last.replace(" ", "T")}Z`);
    if (Date.now() - lastMs < COOLDOWN_MS) {
      return c.redirect(`/rooms/${room.code}?notice=cooldown`, 303);
    }
  }

  // One judge call in flight per room at a time — two submissions racing
  // the same room could otherwise both read the room as still 'active' and
  // both call the judge, possibly both calling markSolved or double-
  // spending free-tier quota on requests that were never going to both
  // matter. A second request arriving while the first is still being judged
  // gets a plain "someone else just asked" notice instead of silently
  // queueing or racing — released in `finally` below so a thrown error
  // can never leave the room permanently locked.
  if (!tryLockRoom(room.id)) {
    return c.redirect(`/rooms/${room.code}?notice=busy`, 303);
  }

  try {
    // Re-read the room's own status after acquiring the lock, not the
    // snapshot read at the top of this handler — the room could have been
    // solved by the request that held the lock just before this one got it,
    // and an already-solved room must never be judged again (also never
    // spends a second API call on a room nobody can still answer into).
    const current = getRoomByCode(room.code);
    if (!current || current.status !== "active") {
      return c.redirect(`/rooms/${room.code}`, 303);
    }

    // Everyone in the room sees that a verdict is pending, not just the
    // asker — the judge call can take up to the configured timeout, and a
    // silent few seconds reads as a dead connection rather than a slow one.
    broadcast(room.id, Date.now(), { label, kind }, "judging");

    // Checked before calling judge(), not inferred from its return value: a
    // misconfigured deploy (no GEMINI_API_KEY, mock not explicitly allowed)
    // is a standing, operator-fixable condition, not the same thing as a
    // single slow/failed Gemini call — the two need different wording so
    // "the judge timed out, try again" isn't shown for a problem retrying
    // can't fix.
    const unavailableMessage =
      "The AI judge isn't configured on this deploy (no GEMINI_API_KEY) — this case can't be judged right now. See README.md's \"Running locally\" / ops notes.";
    if (judgeAvailability() === "unavailable") {
      const entry = insertEntry({
        roomId: room.id,
        sessionId,
        kind: "system",
        body: unavailableMessage,
        verdict: null,
        label: null,
      });
      broadcast(room.id, entry.id, { ...entry, avatarUrl: entryAvatarUrl(entry) });
      return c.redirect(`/rooms/${room.code}`, 303);
    }

    // This room's own puzzle (resolved server-side from room.puzzle_id
    // above) and this room's own recent transcript — never anything the
    // client supplied, and never another room's history.
    const history = getTranscript(room.id);
    const result = await judge(puzzle, history, question, kind);

    // judge() only returns undefined when judgeAvailability() is
    // "unavailable" — already handled above — but availability is a live
    // env read with no snapshot guarantee across the `await` just above, so
    // this stays a defensive fallback rather than an assumed-unreachable
    // branch.
    if (!result) {
      const entry = insertEntry({
        roomId: room.id,
        sessionId,
        kind: "system",
        body: unavailableMessage,
        verdict: null,
        label: null,
      });
      broadcast(room.id, entry.id, { ...entry, avatarUrl: entryAvatarUrl(entry) });
      return c.redirect(`/rooms/${room.code}`, 303);
    }

    if (!result.ok) {
      const entry = insertEntry({
        roomId: room.id,
        sessionId,
        kind: "system",
        body: JUDGE_FAILURE_MESSAGES[result.reason],
        verdict: null,
        label: null,
      });
      broadcast(room.id, entry.id, { ...entry, avatarUrl: entryAvatarUrl(entry) });
      return c.redirect(`/rooms/${room.code}`, 303);
    }

    const verdict = result.verdict;

    const questionEntry = insertEntry({
      roomId: room.id,
      sessionId,
      kind,
      body: question,
      verdict: verdict.verdict,
      label,
    });
    broadcast(room.id, questionEntry.id, { ...questionEntry, avatarUrl: entryAvatarUrl(questionEntry) });

    if (verdict.reply) {
      const replyEntry = insertEntry({
        roomId: room.id,
        sessionId: null,
        kind: "system",
        body: verdict.reply,
        verdict: null,
        label: null,
      });
      broadcast(room.id, replyEntry.id, { ...replyEntry, avatarUrl: entryAvatarUrl(replyEntry) });
    }

    // Only a correct GUESS ever solves the room — judge()/decisionToVerdict()
    // (src/llm.ts) already guarantee a plain question can never resolve to
    // "correct" in the first place, but this is the one place that actually
    // ends the room for everyone, so it re-checks `kind` itself rather than
    // trusting that guarantee alone.
    if (kind === "guess" && verdict.verdict === "correct") {
      // markSolved() before broadcasting the lobby-card change, so any
      // client that reacts to that broadcast by re-querying the room (or
      // the lobby) immediately sees the solved state — never a window
      // where the broadcast has gone out but the database still says
      // 'active'.
      markSolved(room.id);
      broadcastLobbyCardChange(room.id, room.code);
    }

    return c.redirect(`/rooms/${room.code}`, 303);
  } finally {
    unlockRoom(room.id);
  }
});

rooms.post("/rooms/:code/heartbeat", async (c) => {
  if (!isSameOrigin(c)) return c.body(null, 403);
  const room = getRoomByCode(c.req.param("code"));
  if (!room) return c.body(null, 404);

  const sessionId = getOrCreateSessionId(c);
  const body = await c.req.parseBody();
  const resume = body.resume === "1";
  const result = recordHeartbeat(room.id, sessionId, { resume });
  if (!result.ok) return c.body(null, 403);
  return c.json({ credited: result.credited });
});

// Pushes a fresh member roster (with each member's current avatar) to every
// open connection on one room channel — used both by the room's own SSE
// route below (on connect/disconnect) and by routes/profile.ts (after an
// avatar upload/removal/preset change, via sse.ts's updateAvatarForSession(),
// so an already-open room tab picks up the new avatar without a reload).
export function broadcastRoomPresence(roomId: string): void {
  broadcast(roomId, Date.now(), { online: connectionCount(roomId), members: listMembers(roomId) }, "presence");
}

// Patches every ALREADY-RENDERED transcript entry authored by this session
// (not just future ones) once its avatar changes — routes/profile.ts calls
// this (via sse.ts's updateAvatarForSession(), which also mutates the live
// Client records presence reads from) so a room tab left open through an
// avatar change doesn't keep showing stale avatars next to that player's
// earlier messages until a reload. Carries only a session id and the new
// avatar's public URL — never a nickname, bio, or anything else from the
// profile — and public/client.js only ever repoints <img> elements it
// already rendered for that exact session id, never trusts this to
// introduce a new element or change anything else about an entry.
export function broadcastAvatarUpdate(roomId: string, sessionId: string, avatarUrl: string): void {
  broadcast(roomId, Date.now(), { sessionId, avatarUrl }, "avatar-update");
}

rooms.get("/rooms/:code/stream", (c) => {
  const room = getRoomByCode(c.req.param("code"));
  if (!room) return c.notFound();

  const afterId = Number(c.req.query("after") ?? "0");
  const sessionId = getOrCreateSessionId(c);
  const label = displayLabel(room.id, sessionId);
  const avatarUrl = avatarForSession(sessionId);

  const broadcastPresence = () => broadcastRoomPresence(room.id);

  return streamSSE(c, async (stream) => {
    // subscribe() BEFORE reading the DB snapshot, not after: an entry
    // inserted between those two steps used to land in neither — missed by
    // the snapshot query (already run) and broadcast to nobody (not
    // subscribed yet) — a real, reproduced gap, not theoretical: on a slow
    // connection the window between a fresh page load's server-rendered
    // transcript and this stream endpoint actually opening is wide enough to
    // lose a question/answer someone else posted in between, invisible until
    // a manual reload. Subscribing first can instead double-deliver an entry
    // inserted in the now-much-smaller window between subscribe() and the
    // snapshot read (once live, once via snapshot) — harmless, since
    // public/client.js's `seen` id set already drops a duplicate silently.
    let closed = false;
    const unsubscribe = subscribe(room.id, {
      label,
      sessionId,
      avatarUrl,
      write: (chunk) => {
        if (!closed) stream.write(chunk).catch(() => {});
      },
      close: () => {
        closed = true;
      },
    });

    for (const entry of getTranscript(room.id, afterId)) {
      await stream.writeSSE({ id: String(entry.id), data: JSON.stringify(entry) });
    }

    // Tells every connected client (including this one) the new roster.
    broadcastPresence();

    // Fly's proxy and other intermediaries can time out an idle connection;
    // a periodic comment keeps the stream alive without the client parsing it.
    const heartbeat = setInterval(() => {
      if (!closed) stream.writeSSE({ data: "", event: "heartbeat" }).catch(() => {});
    }, 20_000);

    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        broadcastPresence();
        resolve();
      });
    });
  });
});
