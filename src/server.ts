import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { homePage } from "./render/home.ts";
import { readmeRoute } from "./routes/readme.ts";
import { rooms } from "./routes/rooms.ts";
import { lobby } from "./routes/lobby.ts";
import { listActiveRooms } from "./db.ts"; // also runs migrations + seeds the puzzle bank on boot

const app = new Hono();

app.get("/", (c) => c.html(homePage({ rooms: listActiveRooms() })));
app.use("/*", serveStatic({ root: "./public" }));
app.route("/", readmeRoute);
app.route("/", rooms);
app.route("/", lobby);

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`listening on http://0.0.0.0:${info.port}`);
});
