import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { homePage } from "./render/home.ts";
import { readmeRoute } from "./routes/readme.ts";
import { aboutRoute } from "./routes/about.ts";
import { casesRoute } from "./routes/cases.ts";
import { rooms } from "./routes/rooms.ts";
import { lobby } from "./routes/lobby.ts";
import { profileRoute } from "./routes/profile.ts";
import { communityRoute } from "./routes/community.ts";
import {
  getProfile,
  hostLabel,
  listActiveRooms,
  listAvailablePuzzles,
  totalReasoningSeconds,
} from "./db.ts"; // also runs migrations + seeds the puzzle bank on boot
import { getOrCreateSessionId } from "./session.ts";
import { connectionCount } from "./sse.ts";
import { coverForRoom } from "./render/covers.ts";

const app = new Hono();

app.get("/", (c) => {
  const profile = getProfile(getOrCreateSessionId(c));
  // Player counts are as of this page load, not kept live while sitting on
  // the lobby — see PROCESS.md for why that's a deliberate scope cut.
  const rooms = listActiveRooms().map((r) => ({
    ...r,
    players: connectionCount(r.id),
    hostLabel: hostLabel(r.host_session_id),
    coverUrl: coverForRoom(r.slug, r.code, r.cover_path),
  }));
  // Fixed built-in picks: newly shared player stories must not displace them.
  const featuredSlugs = ["turtle-soup-bowl", "silent-phone-call", "elevator-routine"];
  const featuredPuzzles = listAvailablePuzzles()
    .filter((p) => p.authorLabel === null && featuredSlugs.includes(p.slug ?? ""))
    .sort((a, b) => featuredSlugs.indexOf(a.slug!) - featuredSlugs.indexOf(b.slug!))
    .map((p) => ({ id: p.id, slug: p.slug, title: p.title, premise: p.premise, coverPath: p.coverPath }));
  return c.html(
    homePage({ rooms, profile, reasoningSeconds: totalReasoningSeconds(), featuredPuzzles }),
  );
});
// Hono's built-in mime map has no ".ogg" entry (only the rarer ".oga"), so
// serveStatic below would otherwise send this one file as
// application/octet-stream — harmless to a browser (the <audio> tag's own
// canPlayType check doesn't consult the HTTP header), but wrong enough to
// matter for anything else fetching it directly. Corrected AFTER next(),
// since serveStatic sets its own Content-Type header unconditionally.
app.use("/audio/creepy-ambient.ogg", async (c, next) => {
  await next();
  c.header("Content-Type", "audio/ogg");
});
app.use("/*", serveStatic({ root: "./public" }));
app.route("/", readmeRoute);
app.route("/", aboutRoute);
app.route("/", casesRoute);
app.route("/", rooms);
app.route("/", lobby);
app.route("/", profileRoute);
app.route("/", communityRoute);

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`listening on http://0.0.0.0:${info.port}`);
});
