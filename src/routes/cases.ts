import { Hono } from "hono";
import { getProfile, listAvailablePuzzles } from "../db.ts";
import { getOrCreateSessionId } from "../session.ts";
import { casesPage, type CaseSource } from "../render/cases.ts";

const MAX_QUERY_LENGTH = 80;

export const casesRoute = new Hono();

casesRoute.get("/cases", (c) => {
  const profile = getProfile(getOrCreateSessionId(c));
  const rawQ = c.req.query("q")?.trim().slice(0, MAX_QUERY_LENGTH) || undefined;
  const rawSource = c.req.query("source");
  const source: CaseSource = rawSource === "builtin" || rawSource === "player" ? rawSource : "all";
  const puzzles = listAvailablePuzzles(rawQ).filter((p) => {
    if (source === "builtin") return p.authorLabel === null;
    if (source === "player") return p.authorLabel !== null;
    return true;
  });
  return c.html(casesPage({ puzzles, profile, q: rawQ, source }));
});
