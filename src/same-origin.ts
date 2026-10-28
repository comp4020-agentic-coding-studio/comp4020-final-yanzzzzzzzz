// True unless a request plainly came from elsewhere — a cross-origin
// `fetch` carries `sec-fetch-site: cross-site` (or `same-site`, never
// `same-origin`) in every browser that implements Fetch Metadata, and an
// explicit `Origin` header, when a request bothers to send one, has to
// match this app's own. Both headers are easy for a non-browser client to
// spoof, so this is on top of — not instead of — the session cookie's own
// `SameSite=Lax`, which already stops a browser from attaching it to a
// cross-site POST in the first place. Used by any endpoint fired
// automatically/repeatedly or with real write side effects (the room
// heartbeat, community review submission), not every form post.
export function isSameOrigin(c: {
  req: { header: (name: string) => string | undefined; url: string };
}): boolean {
  const fetchSite = c.req.header("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = c.req.header("origin");
  if (origin && origin !== new URL(c.req.url).origin) return false;
  return true;
}
