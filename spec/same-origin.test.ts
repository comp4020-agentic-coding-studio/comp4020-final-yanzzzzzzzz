import { afterEach, expect, it } from "vitest";
import { isSameOrigin } from "../src/same-origin.ts";

// Pure unit tests for src/same-origin.ts — no DB import, no live server,
// just synthetic request-shaped objects. Regression coverage for a real
// production bug: Fly's edge terminates TLS and forwards plain http to the
// machine, so `c.req.url` inside the app is always `http://...` even when
// the browser's own `Origin` header is correctly `https://...`. Comparing
// them unmodified rejected every legitimate same-origin POST in production
// (a scheme-only mismatch that never showed up locally, since local dev is
// plain http on both sides).

const ORIGINAL_FLY_APP_NAME = process.env.FLY_APP_NAME;

afterEach(() => {
  if (ORIGINAL_FLY_APP_NAME === undefined) delete process.env.FLY_APP_NAME;
  else process.env.FLY_APP_NAME = ORIGINAL_FLY_APP_NAME;
});

function req(args: { url: string; origin?: string; secFetchSite?: string; headers?: Record<string, string> }) {
  const headers: Record<string, string> = { ...args.headers };
  if (args.origin !== undefined) headers.origin = args.origin;
  if (args.secFetchSite !== undefined) headers["sec-fetch-site"] = args.secFetchSite;
  return {
    req: {
      url: args.url,
      header: (name: string) => headers[name.toLowerCase()],
    },
  };
}

it("accepts a plain same-origin request with no Origin header at all (e.g. a normal browser navigation)", () => {
  delete process.env.FLY_APP_NAME;
  expect(isSameOrigin(req({ url: "http://localhost:8080/profile" }))).toBe(true);
});

it("accepts a matching Origin against a direct (non-Fly) HTTP request", () => {
  delete process.env.FLY_APP_NAME;
  expect(
    isSameOrigin(req({ url: "http://localhost:8080/profile", origin: "http://localhost:8080" })),
  ).toBe(true);
});

it("accepts a matching Origin against a direct HTTPS request (no Fly, no forwarded header involved)", () => {
  delete process.env.FLY_APP_NAME;
  expect(
    isSameOrigin(req({ url: "https://example.com/profile", origin: "https://example.com" })),
  ).toBe(true);
});

it(
  "the real production bug: on Fly, an HTTPS browser Origin against the internal plain-HTTP request URL is accepted once X-Forwarded-Proto is honored",
  () => {
    process.env.FLY_APP_NAME = "comp4020-final-yanzzzzzzzz";
    const result = isSameOrigin(
      req({
        url: "http://comp4020-final-yanzzzzzzzz.fly.dev/profile/avatar",
        origin: "https://comp4020-final-yanzzzzzzzz.fly.dev",
        headers: { "x-forwarded-proto": "https" },
      }),
    );
    expect(result).toBe(true);
  },
);

it("on Fly, a request with no X-Forwarded-Proto at all still matches a same-scheme Origin", () => {
  process.env.FLY_APP_NAME = "comp4020-final-yanzzzzzzzz";
  expect(
    isSameOrigin(
      req({
        url: "http://comp4020-final-yanzzzzzzzz.fly.dev/profile",
        origin: "http://comp4020-final-yanzzzzzzzz.fly.dev",
      }),
    ),
  ).toBe(true);
});

it("rejects a wrong HOSTNAME even with a correctly-forwarded scheme on Fly — the fix never widens the hostname/port match", () => {
  process.env.FLY_APP_NAME = "comp4020-final-yanzzzzzzzz";
  expect(
    isSameOrigin(
      req({
        url: "http://comp4020-final-yanzzzzzzzz.fly.dev/profile/avatar",
        origin: "https://evil.example",
        headers: { "x-forwarded-proto": "https" },
      }),
    ),
  ).toBe(false);
});

it("rejects a wrong PORT even with a correctly-forwarded scheme on Fly", () => {
  process.env.FLY_APP_NAME = "comp4020-final-yanzzzzzzzz";
  expect(
    isSameOrigin(
      req({
        url: "http://localhost:8080/profile/avatar",
        origin: "https://localhost:9999",
        headers: { "x-forwarded-proto": "https" },
      }),
    ),
  ).toBe(false);
});

it("rejects sec-fetch-site: cross-site regardless of a matching Origin", () => {
  delete process.env.FLY_APP_NAME;
  expect(
    isSameOrigin(
      req({ url: "http://localhost:8080/profile", origin: "http://localhost:8080", secFetchSite: "cross-site" }),
    ),
  ).toBe(false);
});

it("rejects sec-fetch-site: same-site (adjacent subdomain, not this exact origin)", () => {
  delete process.env.FLY_APP_NAME;
  expect(
    isSameOrigin(
      req({ url: "http://localhost:8080/profile", origin: "http://localhost:8080", secFetchSite: "same-site" }),
    ),
  ).toBe(false);
});

it("ignores a forwarded-proto header when NOT actually running on Fly (FLY_APP_NAME unset) — ungated trust would be a real spoofing hole", () => {
  delete process.env.FLY_APP_NAME;
  // Without FLY_APP_NAME, x-forwarded-proto is never consulted, so this
  // mismatched-scheme Origin is correctly rejected rather than "fixed" by
  // a forwarded header nothing legitimate actually set in this environment.
  expect(
    isSameOrigin(
      req({
        url: "http://localhost:8080/profile",
        origin: "https://localhost:8080",
        headers: { "x-forwarded-proto": "https" },
      }),
    ),
  ).toBe(false);
});

it("a malformed/unexpected X-Forwarded-Proto value on Fly is ignored, falling back to the internal URL's own scheme", () => {
  process.env.FLY_APP_NAME = "comp4020-final-yanzzzzzzzz";
  // "https, http" (a comma-joined multi-hop value, or any value that isn't
  // exactly "http"/"https") must never be trusted outright — falls back to
  // the internal request's own scheme (http here), so an Origin claiming
  // https does NOT match.
  expect(
    isSameOrigin(
      req({
        url: "http://comp4020-final-yanzzzzzzzz.fly.dev/profile",
        origin: "https://comp4020-final-yanzzzzzzzz.fly.dev",
        headers: { "x-forwarded-proto": "https, http" },
      }),
    ),
  ).toBe(false);
});

it("a forwarded-host header is never trusted for the hostname match, on or off Fly", () => {
  process.env.FLY_APP_NAME = "comp4020-final-yanzzzzzzzz";
  expect(
    isSameOrigin(
      req({
        url: "http://comp4020-final-yanzzzzzzzz.fly.dev/profile/avatar",
        origin: "https://attacker-controlled.example",
        headers: { "x-forwarded-proto": "https", "x-forwarded-host": "attacker-controlled.example" },
      }),
    ),
  ).toBe(false);
});
