import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  countParticipants,
  createAuthoredPuzzle,
  createRoom,
  displayLabel,
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
import { judge, judgeAvailability } from "../llm.ts";
import { broadcast, connectionCount, listMembers, subscribe } from "../sse.ts";
import { getOrCreateSessionId } from "../session.ts";
import { roomPage } from "../render/room.ts";
import { newRoomPage } from "../render/room-new.ts";
import { roomNotFoundPage } from "../render/not-found.ts";
import { broadcastLobbyCardChange, LOBBY_CHANNEL } from "./lobby.ts";
import { isSameOrigin } from "../same-origin.ts";

const COOLDOWN_MS = 5_000;

const NOTICES: Record<string, string> = {
  cooldown: "Slow down — the same person has to wait a few seconds between questions.",
  "host-only": "Only the host can do that.",
  "not-started": "This case hasn't started yet — wait for the host.",
  "author-guess": "You wrote this case — let someone else crack it.",
  "unavailable-puzzle": "That puzzle isn't available to pick anymore.",
  "incomplete-puzzle": "Fill in a title, premise, and solution to create your case.",
};

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

rooms.post("/rooms", async (c) => {
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
    const shared = body.shared === "on";
    puzzle = createAuthoredPuzzle({ title, premise, solution, authorSessionId: sessionId, shared });
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
    },
    "lobby-update",
  );
  return c.redirect(`/rooms/${room.code}`, 303);
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
    broadcast(room.id, entry.id, entry);
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
  const question = String(body.question ?? "").trim().slice(0, 200);
  if (!question) return c.redirect(`/rooms/${room.code}`, 303);
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

  // Everyone in the room sees that a verdict is pending, not just the asker —
  // the judge call can take up to TIMEOUT_MS, and a silent few seconds reads
  // as a dead connection rather than a slow one.
  broadcast(room.id, Date.now(), { label, kind }, "judging");

  // Checked before calling judge(), not inferred from its return value: a
  // misconfigured deploy (no GROQ_API_KEY, mock not explicitly allowed) is a
  // standing, operator-fixable condition, not the same thing as a single
  // slow/failed Groq call — the two need different wording so "the judge
  // timed out, try again" isn't shown for a problem retrying can't fix.
  if (judgeAvailability() === "unavailable") {
    const entry = insertEntry({
      roomId: room.id,
      sessionId,
      kind: "system",
      body: "The AI judge isn't configured on this deploy (no GROQ_API_KEY) — this case can't be judged right now. See README.md's \"Running locally\" / ops notes.",
      verdict: null,
      label: null,
    });
    broadcast(room.id, entry.id, entry);
    return c.redirect(`/rooms/${room.code}`, 303);
  }

  const history = getTranscript(room.id);
  const verdict = await judge(puzzle, history, question, kind);

  if (!verdict) {
    const entry = insertEntry({
      roomId: room.id,
      sessionId,
      kind: "system",
      body: "The AI judge didn't respond in time, please try again shortly.",
      verdict: null,
      label: null,
    });
    broadcast(room.id, entry.id, entry);
    return c.redirect(`/rooms/${room.code}`, 303);
  }

  const questionEntry = insertEntry({
    roomId: room.id,
    sessionId,
    kind,
    body: question,
    verdict: verdict.verdict,
    label,
  });
  broadcast(room.id, questionEntry.id, questionEntry);

  if (verdict.reply) {
    const replyEntry = insertEntry({
      roomId: room.id,
      sessionId: null,
      kind: "system",
      body: verdict.reply,
      verdict: null,
      label: null,
    });
    broadcast(room.id, replyEntry.id, replyEntry);
  }

  if (verdict.verdict === "correct") {
    markSolved(room.id);
  }

  return c.redirect(`/rooms/${room.code}`, 303);
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

rooms.get("/rooms/:code/stream", (c) => {
  const room = getRoomByCode(c.req.param("code"));
  if (!room) return c.notFound();

  const afterId = Number(c.req.query("after") ?? "0");
  const sessionId = getOrCreateSessionId(c);
  const label = displayLabel(room.id, sessionId);

  const broadcastPresence = () => {
    broadcast(
      room.id,
      Date.now(),
      { online: connectionCount(room.id), members: listMembers(room.id) },
      "presence",
    );
  };

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
