import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { getProfile } from "../db.ts";
import { getOrCreateSessionId } from "../session.ts";
import { renderMarkdown } from "../render/markdown.ts";
import { layout } from "../render/layout.ts";

export const readmeRoute = new Hono();

readmeRoute.get("/readme/", (c) => {
  const md = readFileSync("README.md", "utf8");
  const profile = getProfile(getOrCreateSessionId(c));
  return c.html(
    layout(
      "About · Turtle Soup Puzzle Room",
      `<article class="readme">\n${renderMarkdown(md)}\n</article>`,
      profile,
    ),
  );
});
