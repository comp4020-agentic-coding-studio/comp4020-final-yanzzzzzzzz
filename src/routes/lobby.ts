import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getLobbyCard, hostLabel, listActiveRooms, type LobbyRoom } from "../db.ts";
import { broadcast, connectionCount, subscribe } from "../sse.ts";
import { coverForRoom } from "../render/covers.ts";

export const LOBBY_CHANNEL = "lobby";

export const lobby = new Hono();

// A room's lobby-card shape, with the fields that only make sense once
// joined to live connection state (players), a session lookup (hostLabel),
// or the cover-resolution rules every other case card already uses
// (coverUrl) — the same enrichment src/server.ts's GET / does for the
// initial server-rendered page, so the live SSE path (snapshot + upsert
// below) never shows a different card shape than the one already on screen.
function enrichedRoom(card: LobbyRoom) {
  return {
    code: card.code,
    name: card.name,
    title: card.title,
    status: card.status,
    players: connectionCount(card.id),
    hostLabel: hostLabel(card.host_session_id),
    coverUrl: coverForRoom(card.slug, card.code, card.cover_path),
  };
}

function enrichedCard(roomId: string) {
  const card = getLobbyCard(roomId);
  return card ? enrichedRoom(card) : undefined;
}

// Pushes a live update for one room's card (status/host changed, or no
// longer listable at all once solved) to every open lobby connection — used
// by src/routes/rooms.ts when a room starts, changes host, or is solved.
// Separate from the room-creation broadcast in rooms.ts's POST /rooms, which
// has no existing row to re-read yet. Takes the room's own `code` from the
// caller (which already has the full Room in scope) rather than re-querying
// for it, since a solved room's card is filtered out of getLobbyCard()'s
// result and there'd otherwise be nothing left to key the removal event by.
export function broadcastLobbyCardChange(roomId: string, code: string): void {
  const card = enrichedCard(roomId);
  if (card) {
    broadcast(LOBBY_CHANNEL, Date.now(), card, "lobby-update");
  } else {
    broadcast(LOBBY_CHANNEL, Date.now(), { code }, "lobby-remove");
  }
}

lobby.get("/lobby/stream", (c) => {
  return streamSSE(c, async (stream) => {
    let closed = false;
    const unsubscribe = subscribe(LOBBY_CHANNEL, {
      write: (chunk) => {
        if (!closed) stream.write(chunk).catch(() => {});
      },
      close: () => {
        closed = true;
      },
    });

    // The authoritative fix for "a room created in the gap between this
    // tab's server-rendered page and its EventSource actually opening never
    // appears without a manual reload" — reproduced directly: a room created
    // between GET / and GET /lobby/stream connecting is broadcast to no
    // subscriber (this one wasn't subscribed yet) and was never resent on
    // connect. A full snapshot, sent the instant this stream opens (first
    // connect AND every reconnect, e.g. after Fly's auto-stop/start cycle
    // drops it), means the client's rendered list is reconciled to ground
    // truth unconditionally rather than relying on having caught every
    // individual event since some earlier point in time.
    const rooms = listActiveRooms().map(enrichedRoom);
    await stream.writeSSE({ data: JSON.stringify(rooms), event: "snapshot" });

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
        resolve();
      });
    });
  });
});
