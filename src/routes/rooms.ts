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
import { LOBBY_CHANNEL } from "./lobby.ts";

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
  return c.html(newRoomPage({ mode, puzzles: listAvailablePuzzles(), profile, notice }));
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
  broadcast(LOBBY_CHANNEL, room.id, {
    code: room.code,
    name: room.name,
    title: puzzle.title,
    status: room.status,
    players: 0,
    hostLabel: hostLabel(sessionId),
  });
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

// True unless a request plainly came from elsewhere — a cross-origin
// `fetch` carries `sec-fetch-site: cross-site` (or `same-site`, never
// `same-origin`) in every browser that implements Fetch Metadata, and an
// explicit `Origin` header, when a request bothers to send one, has to
// match this app's own. Both headers are easy for a non-browser client to
// spoof, so this is on top of — not instead of — the session cookie's own
// `SameSite=Lax`, which already stops a browser from attaching it to a
// cross-site POST in the first place; this just gives the heartbeat
// endpoint (unlike every existing POST here, it's fired automatically and
// repeatedly, not once per deliberate form submit) a second, independent
// reason to reject a forged call rather than silently crediting time no
// session actually spent reasoning.
function isSameOrigin(c: { req: { header: (name: string) => string | undefined; url: string } }): boolean {
  const fetchSite = c.req.header("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = c.req.header("origin");
  if (origin && origin !== new URL(c.req.url).origin) return false;
  return true;
}

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
    for (const entry of getTranscript(room.id, afterId)) {
      await stream.writeSSE({ id: String(entry.id), data: JSON.stringify(entry) });
    }

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
