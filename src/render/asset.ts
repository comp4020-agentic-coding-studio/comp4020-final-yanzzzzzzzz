// Bumped whenever a first-party file under /public changes, so its <link>/
// <script> URL changes too — browsers (and any CDN/edge in front of Fly)
// cache a static asset's bytes against its URL indefinitely, and redeploying
// new bytes at the same URL leaves already-open tabs stuck on the stale
// cached copy until a hard refresh. A query string is enough to bust that
// cache; it doesn't need to be a build hash since this repo has no bundler.
const RELEASE = "20261030-profile-history-1";

export function asset(path: string): string {
  return `${path}?v=${RELEASE}`;
}
