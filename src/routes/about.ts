import { Hono } from "hono";
import { getProfile } from "../db.ts";
import { getOrCreateSessionId } from "../session.ts";
import { aboutPage } from "../render/about.ts";

export const aboutRoute = new Hono();

aboutRoute.get("/about", (c) => {
  const profile = getProfile(getOrCreateSessionId(c));
  return c.html(aboutPage(profile));
});
