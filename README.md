# Turtle Soup Puzzle Room

A multiplayer, AI-judged lateral-thinking puzzle room ("turtle soup").
An AI judge holds the full solution to a puzzle and only ever reveals a
cryptic premise. Anyone with a room's code can walk in and read it
immediately — joining is never gated — but questions only start flowing once
the room's host clicks "start the investigation." From there, anyone can ask
a yes/no question or, separately, submit a final guess — two distinct
buttons on the same input, so the judge isn't the only thing deciding which
one a player meant. The judge rules on it, and the answer lands live in one
shared transcript that everyone in the room is watching at the same time.
There are no private per-player threads — solving the case is a group
effort, visible to the whole room as it happens.

A case can be one of the eight built-in puzzles or one a player wrote
themselves — a title, a premise, and a solution, optionally shared to a
public library so other players can pick it too. The homepage doubles as a
lobby: every currently open case is shown as a card (room name, which
puzzle it's playing, its host, its code, whether it's started yet, and how
many people are in it, deduplicated by anonymous session so two tabs on the
same room never count as two people), and a new case appears live on
everyone else's homepage the moment someone starts one — nobody has to
already have the room's link to end up playing together, and anyone with
just the code can type it into the lobby's "Have a code?" box instead. A
room code is always shown with a one-click copy button, alongside a copy
button for the room's full link, both with visible success/failure
feedback.

There's no fixed limit on how many questions a room can ask, and every case
has exactly one solution the judge is holding from the start — a guess is
judged against that solution, never against vibes or a hint budget.

**Content note:** some stories contain horror or graphic content. Proceed
with caution.

The homepage also shows a running total of real reasoning time spent across
every room on the site, counted since that feature shipped (not backfilled
from room-creation timestamps, and not borrowed from any other site's
number) — see "Reasoning time" below for exactly what counts.

## Why this shape

The brief fixes three things any submission has to be: multi-user, real-time,
and persistent. This app isn't three checkboxes bolted onto an unrelated idea
— the gameplay itself needs all three, or it isn't the game:

- **Multi-user.** A puzzle room only works if the people in it are
  distinguishable — otherwise "someone already asked that" has no meaning.
  Each visitor gets an anonymous session cookie on first load and a
  room-scoped nickname ("Anonymous Detective#3") the first time they speak in
  that room. A `/profile` page lets anyone replace that with a chosen
  nickname, one of eight preset avatars, and a one-line bio — still no
  account, no login, just the same anonymous session remembering a name
  instead of assigning one. Whoever creates a room is its host (👑 in the
  member list) and can start the case, hand the role to anyone else in the
  room, or just let someone else play — a host controls the room's pacing,
  not who's allowed into it.
- **Real-time.** The point of a shared transcript is that everyone sees a
  verdict land the moment it does, not on their next manual refresh. The room
  page holds an `EventSource` (Server-Sent Events) connection and appends new
  entries as they're broadcast. The homepage holds its own `EventSource`
  against a separate "lobby" channel on the same pub/sub, so a new case
  appears there live too, without reinventing the mechanism. The room page
  also shows who's currently there by name, not just a count — the same
  live connection set that powers the count, named instead of counted — and
  broadcasts a shared "judge is thinking" state the instant a question or
  guess is submitted, so a slow verdict reads as pending to everyone in the
  room, not as a stuck page to everyone except the person who asked.
  Solving a case shows a recap — the solution, how many questions were
  asked, how many people were in the room, and how long it took — computed
  from data already on hand (the transcript, `room_participants`, and the
  room's own timestamps), not a new stats system.
- **Persists.** A case that vanishes the moment the single Fly machine goes
  to sleep (which it does, by design, between visits) isn't a case anyone can
  come back to. Every room, participant, transcript entry, and
  player-authored puzzle is written to a SQLite database on the `/data`
  volume, which is the one thing that survives a restart or redeploy —
  including across a schema change: `rooms` and `puzzles` both migrate an
  existing database forward rather than assuming a fresh one.

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

## Reasoning time

The homepage shows a running total of real wall-clock time spent reasoning
across every active room on the site. It's the sum of each session's own
effective participation time, deduplicated so a person is never double
counted: three people each playing for 10 minutes shows 30 minutes total, and
the same person's two open tabs on one room (or two rooms at once) only ever
counts their own overlapping real time once.

What counts: a room that's actually `active` (not `waiting` for the host to
start, not already `solved`), with the tab visibly in the foreground —
reading the premise or the live transcript counts as participation, not just
typing. What doesn't count: a `waiting` or `solved` room, a backgrounded or
hidden tab, a dropped connection, a Fly machine asleep between visits, or any
single gap of 5 or more minutes without activity (counted as idle, not
retroactively credited once activity resumes).

The number is server-computed from the server's own clock on every
heartbeat, not a client-reported duration — the client can only say "I just
came back to the foreground," which resets the baseline and can never
manufacture extra credit. It doesn't prove anyone was actually thinking hard;
it's an honest measure of time spent with the room visibly open and
interacted with, nothing more. Counting started the moment this feature
shipped — there's no backfilled history from room-creation timestamps, and
no number borrowed from anywhere else.

## The AI judge

Shown to players as **"Your Partner, Watson"** (`JUDGE_DISPLAY_NAME` in
`src/llm.ts`) — a presentation label only; every function/variable name,
message, and piece of technical behaviour described below is unchanged by
it.

The judge calls [Gemini](https://ai.google.dev)'s native REST
`generateContent` endpoint (`gemini-3.5-flash-lite` by default — Google's
current free-tier, structured-output-capable model; override with
`GEMINI_MODEL` if that changes) with the room's own puzzle — its premise and
solution, resolved server-side from the room, never supplied by a client —
plus a short, clearly-labeled slice of that same room's recent transcript for
pronoun/reference context only. It constrains the response to a single JSON
field via Gemini's `responseSchema`, never free text: a plain question can
only ever come back `yes` / `no` / `irrelevant` / `unknown` / `clarify`, and a
final guess only `correct` / `incomplete` / `incorrect` — two separate
schemas, so a question can never resolve the puzzle no matter how close it
gets. Every reply the player actually sees is one of a handful of fixed
English sentences this app picks based on that enum value — never the
model's own generated wording, and never any model "thought" content. The
solution itself is never sent to a client while a room is active; it's only
read server-side to build the judge's prompt, and shown in full once a room
flips to solved.

The player's question, the puzzle's own text, and the room's history are all
treated as data for the model to judge, never as instructions it follows —
the prompt explicitly tells it to ignore anything embedded in them that asks
it to reveal the solution, switch puzzles, break these rules, or use a tool
it was never given.

Internally, Gemini's five-way question decision and three-way guess decision
are mapped onto the app's original four-value verdict column
(`yes`/`no`/`irrelevant`/`correct`) rather than widening that column's schema:
`unknown` and `clarify` both land as `irrelevant`, and `incomplete` and
`incorrect` both land as `no` — each pair keeps its own distinct fixed reply
text ("Not established." vs. "Please ask one clear question.", "Your
explanation is incomplete." vs. "That explanation contradicts the case.") so
a player can still tell them apart, without a database migration or any
existing room's history needing a backfill. See `PROCESS.md` for why this
compromise was chosen over adding a new column.

A per-session cooldown throttles how fast one person can ask questions, and a
request to the same room is serialized: if a second question or guess arrives
in the same room while the first is still being judged, it's turned away with
a plain "someone else just asked" notice rather than racing the first for the
judge call or a potential solve — this also means an already-solved room is
never judged again, and only a correct **guess**, never a correct-reading
question, can end a room for everyone. A generous timeout guards every real
call; that and every other real-call failure (an expired/invalid key, a
rate-limited or over-quota account, the model declining to answer, a cut-off
or malformed response) shows its own fixed, readable system message instead
of hanging silently, retrying automatically, or quietly falling back to a
different, possibly-paid, model. None of these ever leak the real error text,
the API key, or the puzzle's solution.

**`GEMINI_API_KEY` is a Fly secret in production**, and the app only ever
calls the real judge when it's set. A small deterministic mock judge exists
for testing (keyword-matches the question against the solution's own words),
but it's opt-in, not a silent default: it only runs when `ALLOW_MOCK_JUDGE=1`
is also set, which `pnpm check`'s Docker run and local dev both set
explicitly (`.github/workflows/checks.yml`, this section below). **If a
deploy is missing `GEMINI_API_KEY` and hasn't set `ALLOW_MOCK_JUDGE`, the
judge is unavailable** — every question gets a plain "The AI judge isn't
configured on this deploy" system message instead of a keyword-matching mock
quietly pretending to be the real AI. That split exists specifically so a
forgotten `GEMINI_API_KEY` in production fails loudly and tells you to go set
a secret, rather than serving a never-noticed fake judge indefinitely — which
is exactly what shipped on this app's own Fly deploy for a stretch, under the
prior Groq-backed judge (see `PROCESS.md`).

This app previously called [Groq](https://groq.com)'s chat-completions API
instead — see `PROCESS.md` for why it moved to Gemini and what that changed.

## Running locally

```sh
pnpm install
DATA_DIR=./.data PORT=8080 ALLOW_MOCK_JUDGE=1 node src/server.ts
```

Set `GEMINI_API_KEY` in the environment (or an untracked `.env`) to use the
real judge instead of the mock one — when it's set, `ALLOW_MOCK_JUDGE` is
ignored and the real judge always wins. Without a real key, set
`ALLOW_MOCK_JUDGE=1` to get the deterministic mock for local testing;
without either, every question will correctly show "AI judge isn't
configured," matching what an unconfigured production deploy would show.
`GEMINI_MODEL` optionally overrides the default model name.
`DATA_DIR` defaults to `/data`, which only exists inside the deployed
container; point it somewhere writable for
local runs.

## What's deliberately out of scope

A historical case archive, multiple difficulty levels, room moderation or a
spectator-only mode, editing a puzzle after it's been authored, automatic
host failover if a host goes offline, and an explicit "give me a hint"
command beyond yes/no/irrelevant. A room also doesn't disappear from the
lobby live the instant it's solved, and a lobby card's player count isn't
kept live either — both only refresh on the next homepage load. Noting what
was cut, and why, is part of the process record in `PROCESS.md` — the brief
rewards one idea taken all the way over several built halfway.
