// A real production bug this caught: Fly's edge terminates TLS and forwards
// plain http to the machine (ai.fly.io/docs/networking/request-headers/ —
// X-Forwarded-Proto carries the client's ORIGINAL scheme), so `c.req.url`
// inside the app is always `http://...` even though the browser's own
// `Origin` header is correctly `https://...`. Comparing the browser's
// Origin against `new URL(c.req.url).origin` unmodified therefore rejected
// every legitimate same-origin POST in production (scheme mismatch only),
// while passing identically in local dev (both plain http) — the bug never
// showed up until a real HTTPS request hit it.
//
// Fixed by rebuilding the EXPECTED origin from the request URL's own
// hostname/port (never a client-supplied Host/Forwarded-Host header, which
// is attacker-controlled) with only its scheme corrected from
// X-Forwarded-Proto — and only when actually running under Fly
// (`FLY_APP_NAME` is set by the Fly runtime, never set in local dev/CI, so
// this corrected comparison is reachable only in the one environment where
// the mismatch is real). X-Forwarded-Proto is trusted here for exactly what
// Fly's own docs say it carries: the client's original scheme — nothing
// about hostname or port is ever taken from a forwarded header, since an
// attacker fully controls X-Forwarded-Host/X-Forwarded-Port and widening
// the match to accept those would defeat the whole point of this check.

// True unless a request plainly came from elsewhere — a cross-origin
// `fetch` carries `sec-fetch-site: cross-site` (or `same-site`, never
// `same-origin`) in every browser that implements Fetch Metadata, and an
// explicit `Origin` header, when a request bothers to send one, has to
// match this app's own. Both headers are easy for a non-browser client to
// spoof, so this is on top of — not instead of — the session cookie's own
// `SameSite=Lax`, which already stops a browser from attaching it to a
// cross-site POST in the first place. Used by any endpoint fired
// automatically/repeatedly or with real write side effects (the room
// heartbeat, community review submission, profile saves), not every form
// post.
export function isSameOrigin(c: {
  req: { header: (name: string) => string | undefined; url: string };
}): boolean {
  const fetchSite = c.req.header("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = c.req.header("origin");
  if (!origin) return true;

  const internal = new URL(c.req.url);
  // Only ever trusted for the ONE thing Fly's docs document it carrying
  // (the client's original scheme), only when actually on Fly, and only to
  // correct the scheme of an origin whose hostname/port still come
  // exclusively from the request's own URL — never from any
  // client-controlled forwarded-host/forwarded-port header.
  const onFly = Boolean(process.env.FLY_APP_NAME);
  const forwardedProto = onFly ? c.req.header("x-forwarded-proto") : undefined;
  const scheme = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : internal.protocol.replace(":", "");
  const expected = `${scheme}://${internal.host}`;

  return origin === expected;
}
