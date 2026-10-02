import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { ensureSession } from "./db.ts";

const COOKIE_NAME = "turtle_session";

// Fly's proxy terminates TLS and forwards plain http, but the browser always
// sees https in production — trust x-forwarded-proto for the Secure flag so
// the cookie still round-trips over plain http in local dev.
export function getOrCreateSessionId(c: Context): string {
  const existing = getCookie(c, COOKIE_NAME);
  if (existing) {
    ensureSession(existing);
    return existing;
  }
  const id = randomUUID();
  ensureSession(id);
  const isHttps = c.req.header("x-forwarded-proto") === "https";
  setCookie(c, COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isHttps,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return id;
}
