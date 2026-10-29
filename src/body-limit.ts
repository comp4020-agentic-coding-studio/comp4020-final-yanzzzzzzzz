import type { MiddlewareHandler } from "hono";

// hono/body-limit's own implementation rejects via the Content-Length
// header BEFORE reading any of the body — correct for avoiding the cost of
// buffering an oversized upload, but it leaves however many bytes the
// client already sent (or is still sending) unread on the socket.
// Reproduced locally: on a keep-alive connection, those leftover bytes
// become the start of the NEXT request on the same connection and corrupt
// it; forcing `Connection: close` instead (tried first) only traded that
// bug for an EPIPE on the client mid-upload, a worse experience for a real
// browser tab, not just a test artifact. This drains and discards the
// stream up to the same limit before responding — the connection stays
// healthy and reusable, and the client's own request completes normally
// instead of seeing a broken pipe.
//
// Shared by every multipart-upload POST on this app (room creation's cover,
// the profile avatar) — `maxBytes` and `overLimitRedirect` are the only
// things that differ between callers.
export function multipartBodyLimit(maxBytes: number, overLimitRedirect: string): MiddlewareHandler {
  return async (c, next) => {
    const contentLength = c.req.header("content-length");
    if (contentLength && Number(contentLength) <= maxBytes) {
      return next();
    }
    const body = c.req.raw.body;
    if (!body) return next();

    // Reading the stream here means the downstream handler's own
    // c.req.parseBody() can no longer read it directly — when under the
    // limit, the chunks collected below are replayed into a fresh
    // ReadableStream and swapped onto c.req.raw before calling next(), the
    // same pattern hono/body-limit's own "under the limit" path uses, so
    // parseBody() sees an identical, fully-intact body.
    //
    // When OVER the limit, every remaining chunk is still read and
    // discarded (not just stopped at) — leaving any of the client's bytes
    // unread on the socket is exactly what corrupted a reused keep-alive
    // connection before this fix; draining fully is what keeps the
    // connection healthy for whatever request comes next on it.
    const chunks: Uint8Array[] = [];
    let size = 0;
    let overLimit = false;
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        overLimit = true;
        continue; // keep draining, stop collecting
      }
      chunks.push(value);
    }
    if (overLimit) {
      return c.redirect(overLimitRedirect, 303);
    }

    c.req.raw = new Request(c.req.raw, {
      body: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    return next();
  };
}
