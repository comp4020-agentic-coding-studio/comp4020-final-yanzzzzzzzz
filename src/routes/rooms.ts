import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  createRoom,
  ensureParticipantLabel,
  getPuzzle,
  getRoomByCode,
  getTranscript,
  insertEntry,
  lastQuestionAt,
  markSolved,
  pickRandomPuzzle,
} from "../db.ts";
import { judge } from "../llm.ts";
import { broadcast, connectionCount, subscribe } from "../sse.ts";
import { getOrCreateSessionId } from "../session.ts";
import { roomPage } from "../render/room.ts";
import { LOBBY_CHANNEL } from "./lobby.ts";

const COOLDOWN_MS = 5_000;

export const rooms = new Hono();

rooms.post("/rooms", (c) => {
  const puzzle = pickRandomPuzzle();
  const room = createRoom(puzzle.id);
  broadcast(LOBBY_CHANNEL, room.id, { code: room.code });
  return c.redirect(`/rooms/${room.code}`, 303);
});

rooms.get("/rooms/:code", (c) => {
  const room = getRoomByCode(c.req.param("code"));
  if (!room) return c.notFound();
  const puzzle = getPuzzle(room.puzzle_id);
  if (!puzzle) return c.notFound();

  const sessionId = getOrCreateSessionId(c);
  const label = ensureParticipantLabel(room.id, sessionId);
  const transcript = getTranscript(room.id);
  const notice = c.req.query("cooldown")
    ? "Slow down — the same person has to wait a few seconds between questions."
    : undefined;

  const onlineCount = connectionCount(room.id);
  return c.html(roomPage({ room, puzzle, transcript, label, notice, onlineCount }));
});

rooms.post("/rooms/:code/ask", async (c) => {
  const room = getRoomByCode(c.req.param("code"));
  if (!room) return c.notFound();
  if (room.status === "solved") return c.redirect(`/rooms/${room.code}`, 303);

  const puzzle = getPuzzle(room.puzzle_id);
  if (!puzzle) return c.notFound();

  const sessionId = getOrCreateSessionId(c);
  const label = ensureParticipantLabel(room.id, sessionId);

  const body = await c.req.parseBody();
  const question = String(body.question ?? "").trim().slice(0, 200);
  if (!question) return c.redirect(`/rooms/${room.code}`, 303);

  const last = lastQuestionAt(room.id, sessionId);
  if (last) {
    const lastMs = Date.parse(`${last.replace(" ", "T")}Z`);
    if (Date.now() - lastMs < COOLDOWN_MS) {
      return c.redirect(`/rooms/${room.code}?cooldown=1`, 303);
    }
  }

  const history = getTranscript(room.id);
  const verdict = await judge(puzzle, history, question);

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
    kind: "question",
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

rooms.get("/rooms/:code/stream", (c) => {
  const room = getRoomByCode(c.req.param("code"));
  if (!room) return c.notFound();

  const afterId = Number(c.req.query("after") ?? "0");

  const broadcastOnlineCount = () => {
    broadcast(room.id, Date.now(), { online: connectionCount(room.id) }, "presence");
  };

  return streamSSE(c, async (stream) => {
    for (const entry of getTranscript(room.id, afterId)) {
      await stream.writeSSE({ id: String(entry.id), data: JSON.stringify(entry) });
    }

    let closed = false;
    const unsubscribe = subscribe(room.id, {
      write: (chunk) => {
        if (!closed) stream.write(chunk).catch(() => {});
      },
      close: () => {
        closed = true;
      },
    });
    // Tells every connected client (including this one) the new total.
    broadcastOnlineCount();

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
        broadcastOnlineCount();
        resolve();
      });
    });
  });
});
