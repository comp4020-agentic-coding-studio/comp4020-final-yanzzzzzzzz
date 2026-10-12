import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { homePage } from "./render/home.ts";
import { readmeRoute } from "./routes/readme.ts";
import { rooms } from "./routes/rooms.ts";
import { lobby } from "./routes/lobby.ts";
import { profileRoute } from "./routes/profile.ts";
import { getProfile, hostLabel, listActiveRooms } from "./db.ts"; // also runs migrations + seeds the puzzle bank on boot
import { getOrCreateSessionId } from "./session.ts";
import { connectionCount } from "./sse.ts";

const app = new Hono();

app.get("/", (c) => {
  const profile = getProfile(getOrCreateSessionId(c));
  // Player counts are as of this page load, not kept live while sitting on
  // the lobby — see PROCESS.md for why that's a deliberate scope cut.
  const rooms = listActiveRooms().map((r) => ({
    ...r,
    players: connectionCount(r.id),
    hostLabel: hostLabel(r.host_session_id),
  }));
  return c.html(homePage({ rooms, profile }));
});
app.use("/*", serveStatic({ root: "./public" }));
app.route("/", readmeRoute);
app.route("/", rooms);
app.route("/", lobby);
app.route("/", profileRoute);

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`listening on http://0.0.0.0:${info.port}`);
});
