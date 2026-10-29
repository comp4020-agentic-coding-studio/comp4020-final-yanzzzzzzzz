import { Hono } from "hono";
import { getProfile, listAvailablePuzzles } from "../db.ts";
import { getOrCreateSessionId } from "../session.ts";
import { casesPage, type CaseSource } from "../render/cases.ts";

const MAX_QUERY_LENGTH = 80;

export const casesRoute = new Hono();

casesRoute.get("/cases", (c) => {
  const sessionId = getOrCreateSessionId(c);
  const profile = getProfile(sessionId);
  const rawQ = c.req.query("q")?.trim().slice(0, MAX_QUERY_LENGTH) || undefined;
  const rawSource = c.req.query("source");
  const source: CaseSource =
    rawSource === "builtin" || rawSource === "player" || rawSource === "mine" ? rawSource : "all";
  // Passing the viewer's own session id is what makes a player's own private
  // case show up here at all (listAvailablePuzzles() otherwise only returns
  // shared=1 rows) — never another session's id, so nobody else's private
  // case can leak through this route.
  const puzzles = listAvailablePuzzles(rawQ, sessionId).filter((p) => {
    if (source === "builtin") return p.authorLabel === null;
    if (source === "player") return p.authorLabel !== null;
    if (source === "mine") return p.isMine;
    return true;
  });
  return c.html(casesPage({ puzzles, profile, q: rawQ, source }));
});
