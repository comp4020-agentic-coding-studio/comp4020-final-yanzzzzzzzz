import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { renderMarkdown } from "../render/markdown.ts";
import { layout } from "../render/layout.ts";

export const readmeRoute = new Hono();

readmeRoute.get("/readme/", (c) => {
  const md = readFileSync("README.md", "utf8");
  return c.html(layout("About · Turtle Soup Puzzle Room", `<article class="readme">\n${renderMarkdown(md)}\n</article>`));
});
