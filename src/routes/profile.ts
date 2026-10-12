import { Hono } from "hono";
import { getProfile, profileStats, setProfile } from "../db.ts";
import { getOrCreateSessionId } from "../session.ts";
import { AVATARS, profilePage } from "../render/profile.ts";

export const profileRoute = new Hono();

profileRoute.get("/profile", (c) => {
  const sessionId = getOrCreateSessionId(c);
  const profile = getProfile(sessionId);
  const stats = profileStats(sessionId);
  const saved = c.req.query("saved") === "1";
  return c.html(profilePage({ profile, stats, saved }));
});

profileRoute.post("/profile", async (c) => {
  const sessionId = getOrCreateSessionId(c);
  const body = await c.req.parseBody();

  const nickname = String(body.nickname ?? "").trim().slice(0, 24) || null;
  const bio = String(body.bio ?? "").trim().slice(0, 140) || null;
  const requestedAvatar = String(body.avatar ?? "");
  const avatar = AVATARS.includes(requestedAvatar) ? requestedAvatar : null;

  setProfile(sessionId, { nickname, avatar, bio });
  return c.redirect("/profile?saved=1", 303);
});
