import { Hono } from "hono";
import { getProfile, listAvailablePuzzles } from "../db.ts";
import { getOrCreateSessionId } from "../session.ts";
import { casesPage } from "../render/cases.ts";

const MAX_QUERY_LENGTH = 80;

export const casesRoute = new Hono();

casesRoute.get("/cases", (c) => {
  const profile = getProfile(getOrCreateSessionId(c));
  const rawQ = c.req.query("q")?.trim().slice(0, MAX_QUERY_LENGTH) || undefined;
  const puzzles = listAvailablePuzzles(rawQ);
  return c.html(casesPage({ puzzles, profile, q: rawQ }));
});
