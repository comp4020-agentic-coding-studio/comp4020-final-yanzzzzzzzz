# Process overview

## The brief, and what it fixed before any code

Before writing any app code, I wrote the harness I'd hold myself to:
[`dca01b8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/dca01b8)
set the standing rules — commit and push every change immediately with a
reason, never weaken `spec/invariants.test.ts`, root-cause failures instead
of retrying blind, record reasoning for real choices. Then I transcribed the
brief's three fixed technical requirements (multi-user, real-time, persists)
into the same file in
[`c4b317b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/c4b317b),
including the one implication I didn't want to lose later: on Fly's
auto-stop/auto-start machine, a dropped long-lived connection isn't a bug —
one that never recovers is.

## Choosing an idea

I brainstormed five directions that would technically satisfy multi-user /
real-time / persists as separate checkboxes, and rejected all of them myself
for being exactly that — a plausible real-time feature bolted onto an
otherwise generic app, not an idea that needed those three properties to
exist at all. I asked for a steer instead of continuing to generate options
alone, and got back two directions: a collaborative AI-judged 海龟汤
(lateral-thinking puzzle) room, or a multiplayer 剧本杀 (script-murder game).
剧本杀 needs per-player private information and a much larger content
pipeline (multiple character scripts, timed phases) to be any good — scope
that doesn't fit a project this size. 海龟汤 needs exactly the three fixed
properties to be a game at all: a room that doesn't distinguish who asked
what isn't multiplayer, a transcript nobody sees land live isn't real-time,
and a case that vanishes when the one Fly machine sleeps isn't persistent.
Picked that one.

## A constraint the brief's own tooling didn't cover

Partway into planning I checked whether the course's LiteLLM proxy key could
be the judge's AI backend, since using it would have meant no second secret
to manage. It's ANU-network-restricted by the comment in
`.github/trufflehog.yml` itself, and I confirmed against the published brief
page that nothing else is documented as a runtime-AI mechanism for a
deployed app — Fly's machines and GitHub's own runners both sit outside that
network, so neither can reach it. I surfaced this rather than silently
picking a workaround, and asked how to handle it; the answer was a free-tier
third-party provider. I chose Groq specifically: an OpenAI-compatible API
(so the judge code stays simple) with low enough latency that a yes/no
verdict doesn't make the room feel like it's waiting on something.

## Build

The full architecture — stack, data model, routes, the judge's prompt and
failure handling, the Dockerfile, and an explicit MVP-vs-cut scope list — was
written up and approved before any code, so the build itself was mostly
execution against that plan, in
[`5f5e97b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/5f5e97b).
A few choices worth recording because they weren't obvious going in:

- **`node:sqlite` over `better-sqlite3`.** Node 24 ships a built-in SQLite
  binding, which means no native toolchain has to exist in the runtime Docker
  stage at all — the whole app ships as one esbuild bundle plus static
  assets, which matters directly for staying inside the course's 256 MB /
  one-machine budget.
- **SSE over WebSockets.** `EventSource` reconnects on its own after a drop;
  a WebSocket needs that logic hand-rolled, and Fly's auto-stop/auto-start
  cycle guarantees every connection gets dropped sooner or later. Fewer
  moving parts for the property the brief actually cares about.
- **No SPA framework.** Every room page is server-rendered and works fully
  with JavaScript off — plain `<form>` posts, full-page reloads. One small
  vanilla-JS file layers on live SSE updates and a non-reloading submit when
  JS is available. This was a deliberate scope cut, not an oversight: the
  brief rewards one idea taken all the way over a feature list spread thin,
  and a bundler/framework step buys nothing a puzzle room's UI needs.
- **Mock judge fallback when `GROQ_API_KEY` is unset.** This is always the
  case in CI (no third-party secret is configured there, by choice, to avoid
  depending on one for a green `pnpm check`), so `src/llm.ts` falls back to
  deterministic keyword-matching whenever the key is missing. The production
  deploy always carries the real key as a Fly secret, so this path never
  runs against real traffic — it exists purely so CI stays fast, free, and
  not dependent on Groq being up.
- **The Dockerfile runs as root.** The `/data` volume's ownership on first
  mount isn't something I could verify without a real Fly deploy or a local
  Docker daemon (neither was available while building this), so I chose the
  simpler, honestly-labelled option over a non-root user that might silently
  fail to write to the volume. This is called out as a risk-based decision
  in the Dockerfile itself, not left implicit.

## A test bug I found and fixed, not an app bug

While getting `pnpm check` green, `spec/rooms.test.ts`'s "distinguishes
multiple anonymous sessions" test failed: a fresh room's first visitor came
back labelled `Anonymous Detective#2`, not `#1`. Tracing it through, the test's own
`createRoom()` helper visited the room page once already (purely to extract
a session cookie for other tests), which itself registered an anonymous
participant and consumed the `#1` slot before the test's own "first visitor"
request ever ran. The app's participant numbering was correct the whole
time; the test was shifting its own count by one. Fixed by splitting
`createRoom()` (creates the room, nothing else) from a separate `visitRoom()`
helper (visits as a new anonymous session), so no test accidentally
pre-consumes a participant slot it didn't mean to.

## Shipping and translating to English

Shipping flipped the repo public and ran `checks` via `workflow_dispatch`
(the flip itself triggers no push event). That run was the *first* time the
`check` job's `docker build`/`docker run` step ever executed — it only runs
once the repo is public (`if: !github.event.repository.private`), so while
private, `pnpm check` locally was the only signal. It passed, and
`verify-deploy.sh` independently confirmed the live Fly URL serves the page
and its one asset, not just a 200. The deployed commit is tagged `crit-8`.

Separately, the app launched entirely in Chinese — the 海龟汤 genre name, the
UI chrome, the nine seed puzzles, and the AI judge's prompt and fallback
strings. Asked to make it English, the choice was full translation over
UI-chrome-only: translating just the buttons and labels but leaving the
puzzle premises and the judge's own replies in Chinese would mean the actual
content a player reads mid-game still wasn't in the requested language, which
defeats the point. The nine puzzles are faithful English retellings of the
same lateral-thinking riddles (same premise/solution pairs — these are a
well-known genre in English too, usually called "turtle soup" or "situation
puzzles" there as well), not new content, so the mock judge's keyword match
against `puzzle.solution` keeps working unchanged. `海龟汤` itself stays as a
proper noun in this file and the README, labelling the genre the game is
built on.

## A real bug: translated code, unchanged production data

After the English translation deployed, the live room still showed a
Chinese puzzle premise. Root cause: `seedPuzzlesIfEmpty()` only inserted
`SEED_PUZZLES` when the `puzzles` table was empty, and the very first real
deploy to the Fly volume (today, since the repo was private until the ship)
had already populated that table from the pre-translation Chinese
`src/data/puzzles.ts`. Every later deploy shipped new code but never
touched the rows already sitting on `/data` — translating the seed data and
redeploying did nothing to content that persistence was, correctly, no
longer willing to overwrite. The fix makes puzzle seeding reconcile against
the code on every boot instead of a one-time "if empty" insert: puzzle text
is reference content tracked in git, not user data, so it's fine to resync
it, and any room whose puzzle fell out of that content gets cleared with
it, since that only happens when the puzzle bank itself changed underneath
it (there was no real user data yet to lose).

## A shared lobby, from user feedback

After shipping, feedback was that the app didn't actually feel multiplayer:
hitting "start a new case" always made a *new* room, so two people on the
homepage at once each ended up alone unless one manually sent the other a
link. Fixed by turning the homepage into a lobby — every open case is
listed as a join link, and a new one appears live on everyone else's
homepage the moment it's created
([`1b25e42`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/1b25e42),
[`05e3929`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/05e3929)).

The real decision was reuse vs. a second mechanism: `src/sse.ts`'s pub/sub
was already generic enough to key by any channel name, not just a room id,
so a `"lobby"` channel plus one `broadcast()` call on room creation covers
it — no polling, no new infra, consistent with the one real-time mechanism
the brief is judged on. Deliberately not live: a solved room leaving the
lobby, which would mean broadcasting on every solve too for a case (a
stale-but-harmless join link for a few minutes) that doesn't block anyone.

## One red commit in that sequence

`1b25e42` (the lobby's backend commit) shows red in CI history:
`server.ts` was changed there to call `homePage({ rooms: listActiveRooms() })`,
but `homePage()`'s signature only grew that parameter in the very next
commit (`05e3929`), so that one commit, checked out on its own, doesn't
typecheck. Root cause was splitting the backend/frontend commits without
running `pnpm typecheck` against each commit individually, only against the
cumulative working tree at the end. Caught from CI, not before pushing.
The repo's "never rewrite history on main" rule means that red run stays
in the log rather than getting squashed away; every commit after it is
green, including the final state. Will typecheck each commit before it's
pushed going forward, not just the end state.

## Online count, from the same connection set already tracked

Another piece of feedback: the room should show how many people are
actually in it. `src/sse.ts` already keeps a `Set<Client>` per channel for
delivering the transcript — its size *is* the online count, so
`connectionCount()` is a one-line read, not new state
([`2535743`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/2535743)).
The one real decision was picking "currently connected" over "has ever
joined" (the number `room_participants` already gives, used for
nicknames) — "online" should mean online. Broadcasting it over a named
`presence` SSE event, rather than the default one entries use, was the
small but necessary part: without a way to tell the two apart, `client.js`
would try to render a `{ online: n }` payload as a transcript entry.

## Online count not dropping — a navigation gap, not a counting bug

Feedback: closing a room's last tab correctly dropped the online count,
but clicking the brand link back to the homepage didn't. Before touching
code, checked whether the counting itself was actually wrong: simulated 4
concurrent connections to one room plus an independent observer connection
and closed them one at a time with a client-side `AbortController`, both
against the local server and the live Fly deploy. Every close broadcast
the correct new number to the observer immediately — the server-side
logic was right both times.

The gap was specifically in *when* a real browser tells the server a
connection is gone. Closing a tab outright destroys its whole
networking context immediately; clicking a link away just stops the page
from reading the stream; the browser isn't obligated to abort that
in-flight request right away; and only when it eventually does does the
server even get a chance to notice. Fix
([`a924da3`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/a924da3))
was on the client: close the `EventSource` explicitly on the `pagehide`
event (fires on any kind of navigating-away, including a plain link
click), so the server is told the moment the user leaves instead of
whenever the browser gets around to tearing the connection down.

## Crit-9: from "how many" to "who" — the week's concurrency decision

Crit-9's brief asks for one documented decision about multi-user behavior,
suggesting (among others) "whether people can see who else is here, and
how." The room already had an online *count* (`connectionCount()`,
[`2535743`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/2535743))
but not a roster — a separate review of the live app flagged this as the
same gap, independently.

Two ways to answer "who's here": (a) a `last_seen` column on
`room_participants`, updated on a heartbeat, so presence is a DB-backed
fact; or (b) extend the same in-memory SSE connection tracking the online
count already uses, so a client is "present" exactly as long as it holds an
open connection. Picked (b), for the same reason SSE itself was picked over
WebSockets: it reuses a mechanism already proven correct (the count's logic
was verified against real concurrent connections, see above) instead of
adding a second source of truth for the same fact. The cost: the member
list is empty for everyone immediately after a redeploy, until each open
tab reconnects and re-announces itself — acceptable, because presence is
inherently transient (who's *currently* watching), not data that needs to
survive a restart the way a room's transcript does. `src/sse.ts`'s
`Client` type now carries an optional `label`; `listMembers(channel)` reads
the same `Set` `connectionCount` already reads, just naming its members
instead of counting them, and the existing `"presence"` SSE event's payload
grew from `{ online }` to `{ online, members }` rather than adding a second
event type.

Tested with two real concurrent SSE connections (`spec/sse.test.ts`), since
no existing test opened an actual stream — reading the raw SSE wire format
off the response body directly, since Node's test runtime has no
`EventSource`. Caught one test-authoring mistake while writing it: an
early `return` inside a `for await...of` loop over the async generator
silently closes that generator (calls its `.return()`), so a second call to
read "the next event" off the same generator always reported the stream had
ended, even though the real HTTP connection was still open. Switched to
driving the generator's `.next()` by hand instead of `for await`, which
doesn't trigger that implicit close.

## Splitting "ask" from "guess", and a shared waiting state

A second piece of feedback (from a review of the live app): the room's one
free-text box did double duty for both yes/no questions and a final guess,
which the AI judge alone disambiguated — a plain question phrased
confidently could get read as a guess and end the game early, with no way
for a player to signal which they meant.

The schema already had an unused `kind: 'guess'` value sitting in
`qa_entries`'s CHECK constraint from the original build — nothing had ever
set it. Added a second submit button (`name="kind" value="guess"`) to the
same form rather than a second form, so there's still one input box and one
`POST /rooms/:code/ask`; the browser sends whichever button's `name`/`value`
pair was clicked (`event.submitter` on the client, `body.kind` on the
server). The judge's system prompt now branches on `kind`: a question can
only come back yes/no/irrelevant, a guess can only come back correct/no —
and `clampToKind()` in `src/llm.ts` remaps a verdict that ignores that
instruction, rather than trusting the model's compliance blindly.

Also added a shared "judge is thinking" state, broadcast on the room's SSE
channel as soon as a request starts (not after it resolves): previously
only the person who asked saw a disabled button, so everyone else watching
the same transcript saw nothing happen for up to 10 seconds (`TIMEOUT_MS`)
before an answer appeared — on a slow connection that reads as the page
being stuck, not as a judge that's still thinking. This is also this week's
second candidate for "what reaches other people live" — the pending state
itself is now real-time, not just the resolved answer.

## Verifying the real deployment, for crit-9

Assumed CI's `deploy` job (`.github/workflows/checks.yml`, gated on the repo
being public and non-template) would need a local `flyctl` login to check on
— it doesn't. It already runs on every push to `main` using a `FLY_API_TOKEN`
GitHub secret the course provisioned, and had already redeployed both of
this week's commits by the time I checked (`gh run view` on each push's run
showed `check` and `deploy` both green, finishing in under a minute). No
manual deploy step was needed; I'd been about to go hunting for a way to
auth `flyctl` locally before realizing the live site was already current.

With that confirmed, ran two checks directly against
`https://comp4020-final-yanzzzzzzzz.fly.dev` (not localhost) to verify
real-time actually holds on the deployed shape, not just in a local dev
process:

- **Transcript propagation**: opened one SSE connection as session B, posted
  a question as session A, and timed how long until B's stream received both
  the question entry and the judge's reply — **17ms**.
- **Presence propagation**: opened a connection as A, then had B connect and
  disconnect, timing how long until A's own stream reflected each change —
  **16ms** for B joining, **29ms** for B leaving.

Both several orders of magnitude inside the brief's "about a second." These
numbers also indirectly confirm the deployed app's own cross-connection
broadcast path works end to end on Fly's actual infrastructure, not just
against Node's loopback interface locally.

## A chosen nickname, without turning this into an account system

The same review that flagged the missing member list also pointed out that
every player still shows up as "Anonymous Detective#N" with no way to pick
an identity that persists across visits. Asked for: a one-time nickname and
an avatar on first visit, editable later, carried into the transcript and
member list, plus a one-line bio and simple participation/solved counts —
explicitly *not* a login system.

Added a `/profile` page (no new auth: it reads/writes the same anonymous
`sessions` row the cookie already identifies) with a nickname field, a fixed
8-emoji avatar picker (not free-form upload or a URL — no image hosting, no
moderation surface, and a fixed set means a submitted avatar can be
rejected outright if it isn't one of the eight, rather than trusted and
escaped), and a bio line. `sessions` gained three nullable columns
(`nickname`, `avatar`, `bio`), added with a guarded `ALTER TABLE` that
checks `PRAGMA table_info` first, since re-running `ADD COLUMN` on a /data
volume that already has it would error.

The integration choice: rather than threading a second "avatar" field
through `QaEntry`, SSE's `Client` type, and every rendering function that
already passes a plain label string around, `displayLabel(roomId,
sessionId)` in `src/db.ts` bakes the avatar into that same string
(`"🐢 Riko"` instead of `"Riko"` plus a separate icon) before it ever reaches
the transcript, the member list, or the "you are" line. One string, not two
fields threaded through four files — the avatar shows up everywhere a label
already did, for free. The cost: a nickname/avatar change only affects new
messages going forward, not the label baked into already-sent transcript
entries — the same "history reflects what was true when it happened"
tradeoff a display name change makes in any chat app, not a bug.
`ensureParticipantLabel` (the `#N` auto-label) still always runs first, even
when a nickname overrides what's displayed, so participation counts and the
numbering stay accurate for sessions that never set a nickname.

Stats (`profileStats()`) are computed from existing tables — `COUNT(DISTINCT
room_id)` in `room_participants` for "joined", joined against `rooms.status
= 'solved'` for "solved" — no new counters to keep in sync.

## Lobby cards, and a deliberately thin "state" distinction

The same review's biggest complaint: the lobby was a bare list of "Join case
XXXXX" links — no sense of what a case was before joining it, or whether it
had even started. Gave `puzzles` a spoiler-free `title` (e.g. "The Elevator
Routine", not "The Dwarf's Elevator"), and `listActiveRooms()` now joins
against it and derives a `started` flag — `EXISTS(... WHERE kind IN
('question', 'guess'))` — rather than storing a new status.

The review's fuller proposal included a three-state room lifecycle with a
host, a "ready" step, and an explicit invite-before-start flow. That's in
real tension with this app's own stated design in `README.md`: no accounts,
no gatekeeping, anyone with the link (or now, anyone who types the code into
the lobby's "Have a code?" box — new `GET /join`) can walk straight into a
case already in progress and start reading the transcript. A host/ready
system would be a different game's shape, not a refinement of this one.
Resolved it by taking only the *visible* half of the ask: "not started yet"
vs. "in progress" is now a real, derived distinction a lobby card shows —
but it's a read of existing data (has anyone asked anything yet?), not a new
gate anyone has to clear to play. Noting the tension and the narrower choice
here rather than quietly building past it, or quietly ignoring the fuller
ask.

Player counts on lobby cards are computed at page-load time
(`connectionCount(room.id)`, the same mechanism the room page's own count
uses) — deliberately **not** kept live while someone sits on the homepage,
since that would mean re-broadcasting every room's presence changes onto the
lobby channel too. The lobby already has one documented live-vs-not-live
line (a solved room doesn't disappear from the list until the next load);
this is the same kind of cut, for the same reason: the brief's real-time
grading is about what happens inside a shared session, not lobby metadata
freshness.

Also added a plain `title` to `src/data/puzzles.ts`'s 8 seed puzzles. Since
`seedPuzzlesIfEmpty()`'s up-to-date check now includes title in what it
diffs, this triggered the same full reseed-and-clear-rooms path a content
edit already does (documented earlier in this file) — expected, not a
surprise.

## A solve recap, from data already on hand

Last item from the round-1 priority list: solving a case just swapped in the
solution text with no sense of how the room got there. The recap
(`recapHtml()` in `src/render/room.ts`) adds a question count, a participant
count, and elapsed time, plus "play again" / "back to lobby" actions — all
computed from data the app already had, not new tracking:

- questions asked: filtering the transcript already loaded for the page by
  `kind`, no query of its own.
- participants: `countParticipants()`, a one-line count against
  `room_participants` — the same table `ensureParticipantLabel` already
  writes to.
- elapsed time: the solved entry's own `created_at` minus the room's
  `created_at` (added to `Room`/`getRoomByCode`/`createRoom`'s SELECTs,
  which didn't carry it before). Both are SQLite's
  `datetime('now')` strings, parsed with the same UTC-assume trick the
  cooldown check already uses.

Didn't add a separate "key questions" highlight reel — the full transcript
is still right below the recap, and a short room's worth of Q&A doesn't need
a curated summary of itself. Replay *is* scrolling down.

The recap test itself was flaky on first write — failing roughly 1 run in 8,
which matched the 1-in-8 odds of `pickRandomPuzzle()` landing on "The Dinner
Party Soup" specifically. Root cause: that puzzle's solution contains a
literal `"` (a quoted recipe name), which the room correctly HTML-escapes to
`&quot;` when rendering — the test was asserting the raw, unescaped solution
string appeared in the page, which only a quote-free puzzle would satisfy.
Not an app bug; fixed the assertion to compare against the same escaped form
instead of retrying until a different puzzle got picked.

## What's still open

**`GROQ_API_KEY` is not set on the live Fly app.** Posting a question to the
deployed site returned "Yes (mock judge: keyword match)" — the literal mock
fallback string from `src/llm.ts`, which only runs when the key is absent.
The app has been serving the keyword-matching mock judge in production, not
the real AI, which `src/llm.ts`'s own comment explicitly says should never
happen outside CI. Needs `flyctl secrets set GROQ_API_KEY=... -a
comp4020-final-yanzzzzzzzz` with a real key before relying on the judge's
actual quality at the crit.

A manual keyboard-only / throttled-network pass in a real browser (this
environment has no GUI browser available) is still open as well.
