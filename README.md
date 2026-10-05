# Turtle Soup Puzzle Room

A multiplayer, AI-judged lateral-thinking puzzle room (海龟汤 / "turtle soup").
An AI judge holds the full solution to a puzzle and only ever reveals a
cryptic premise. Anyone who opens the room's link can ask a yes/no/irrelevant
question or submit a final guess; the judge rules on it, and the answer lands
live in one shared transcript that everyone in the room is watching at the
same time. There are no private per-player threads — solving the case is a
group effort, visible to the whole room as it happens.

The homepage doubles as a lobby: every currently open case is listed there as
a join link, and a new case appears on everyone else's homepage the moment
someone starts one, live — nobody has to already have the room's link to end
up playing together.

## Why this shape

The brief fixes three things any submission has to be: multi-user, real-time,
and persistent. This app isn't three checkboxes bolted onto an unrelated idea
— the gameplay itself needs all three, or it isn't the game:

- **Multi-user.** A puzzle room only works if the people in it are
  distinguishable — otherwise "someone already asked that" has no meaning.
  Each visitor gets an anonymous session cookie on first load and a
  room-scoped nickname ("Anonymous Detective#3") the first time they speak in that room.
  No account, no login — the barrier to joining a room is "open the link."
- **Real-time.** The point of a shared transcript is that everyone sees a
  verdict land the moment it does, not on their next manual refresh. The room
  page holds an `EventSource` (Server-Sent Events) connection and appends new
  entries as they're broadcast. The homepage holds its own `EventSource`
  against a separate "lobby" channel on the same pub/sub, so a new case
  appears there live too, without reinventing the mechanism.
- **Persists.** A case that vanishes the moment the single Fly machine goes
  to sleep (which it does, by design, between visits) isn't a case anyone can
  come back to. Every room, participant, and transcript entry is written to a
  SQLite database on the `/data` volume, which is the one thing that survives
  a restart or redeploy.

## Stack

Node 24 + TypeScript, [Hono](https://hono.dev) for routing and its built-in
SSE streaming helper, and Node's built-in `node:sqlite` for storage — chosen
specifically because it needs no native build step, which keeps the Docker
image simple and the 256 MB runtime budget easy to stay under.

Server-sent events were chosen over WebSockets or polling because of how Fly
runs this app: the machine auto-stops when idle and auto-starts on the next
request, so any long-lived connection has to recover cleanly after being cut
off mid-session. `EventSource` reconnects on its own with no hand-rolled
keepalive or reconnect logic; a dropped connection isn't a bug here, a
connection that never recovers would be.

The frontend is server-rendered HTML with one small vanilla JS file layered
on top — no SPA framework, no bundler step for the frontend. Every room page
works end to end with JavaScript turned off (plain `<form>` posts, full-page
reloads); the JS only adds live updates and skips the reload on submit when
it's available. Deliberate scope control: one idea built all the way, not a
feature list spread thin.

## The AI judge

The judge calls [Groq](https://groq.com)'s OpenAI-compatible chat completions
API (`llama-3.3-70b-versatile`) with the puzzle's premise, its solution, and
the room's recent transcript, and asks for a strict JSON verdict —
`yes` / `no` / `irrelevant` / `correct` — plus a short in-character reply.
The solution itself is never sent to a client while a room is active; it's
only read server-side to build the judge's prompt, and shown in full once a
room flips to solved.

A per-session cooldown throttles how fast one person can ask questions, and a
10-second timeout guards every call: if Groq doesn't answer in time, the room
gets a plain "The AI judge didn't respond in time, please try again shortly"
message instead of hanging silently. `GROQ_API_KEY` is a Fly secret in production; with it unset — which
is always true in CI, since the course's own LLM proxy key is
network-restricted to ANU and unreachable from a Fly machine or a GitHub
runner — the app falls back to a small deterministic mock judge. That keeps
`pnpm check` fast, free, and not dependent on a third-party secret, without
ever running in the deployed app.

## Running locally

```sh
pnpm install
DATA_DIR=./.data PORT=8080 node src/server.ts
```

Set `GROQ_API_KEY` in the environment (or an untracked `.env`) to use the
real judge instead of the mock one. `DATA_DIR` defaults to `/data`, which
only exists inside the deployed container; point it somewhere writable for
local runs.

## What's deliberately out of scope

A historical case archive, multiple difficulty levels or user-submitted
puzzles, room moderation or a spectator-only mode, and an explicit "give me a
hint" command beyond yes/no/irrelevant. A room also doesn't disappear from
the lobby live the instant it's solved — only on the next homepage load.
Noting what was cut, and why, is part of the process record in
`PROCESS.md` — the brief rewards one idea taken all the way over several
built halfway.
