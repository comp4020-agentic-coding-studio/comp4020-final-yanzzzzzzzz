import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribe } from "../sse.ts";

export const LOBBY_CHANNEL = "lobby";

export const lobby = new Hono();

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
