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

## Reopening the host/ready decision, and player-authored puzzles

A second round of review, after crit-9, pushed for a host role with a real
not-started→host-starts→in-progress lifecycle, player-authored puzzles with
an optional public library, and a room name distinct from the puzzle title —
explicitly scoped by the user as crit-10 (2026-10-21) prep, done now rather
than waiting.

This directly reopens a decision from earlier the same day: I'd declined a
host/ready-up lifecycle as conflicting with the app's "no gatekeeping"
design (anyone with a room's code can walk in and read the transcript
immediately). The reviewer's counter is correct and narrower than what I'd
rejected: a host role doesn't have to gate who can *join* — only who can
*start* a room that hasn't started. Joining, reading, and waiting are still
open to anyone; only asking a question is gated behind the host clicking
"start." Built it, with this reversal recorded here rather than silently
overwriting the earlier reasoning.

**Schema**: `rooms.status`'s CHECK constraint only allowed `('active',
'solved')`, and SQLite can't ALTER a CHECK constraint in place. Rebuilding
the table (rename, recreate with `'waiting'` added, copy, drop) is a real,
one-time migration — guarded by checking `sqlite_master.sql` for `'waiting'`
first — rather than a new column, and it's **non-destructive to real room
data**, unlike the puzzle-reseed wipe above (which only ever touches
reference content): every existing room survives, backfilled with the
status its own data already implied (a question/guess present → `active`,
none → `waiting`) and a best-effort host (its earliest joiner, since nothing
recorded an explicit host before this existed). Verified against a seeded
pre-migration database shaped like today's live one before trusting it.

**Two adaptations from the literal request**, not built as asked:
- "A popup to create a room" → a real page at `GET /rooms/new`
  (`?mode=existing` / `?mode=author`, plain links and forms). A JS modal with
  internal tab state can't work with JavaScript off, which breaks this app's
  stated "works end to end with JS disabled" design; a page with two
  query-selected modes does, for free, and still gets a JS-only live puzzle
  preview layered on top as a non-load-bearing extra.
- "Puzzle versioning, so an author's later edit doesn't change an
  in-progress room's answer" → solved by *never implementing puzzle editing
  as an UPDATE*, not by snapshotting puzzle content onto each room.
  `rooms.puzzle_id` already points at one immutable row forever; as long as
  a future edit feature inserts a new row instead of mutating the old one,
  every room's answer is already permanently pinned. No snapshot column
  needed — the existing data model already has this property, it just
  wasn't being relied on yet.

**Puzzle authoring never exposes a solution it doesn't have to**:
`listAvailablePuzzles()` (the picker on `GET /rooms/new`) selects only
`id, title, premise` — the SQL itself can't leak a solution, not merely a
template choosing not to render one. A puzzle's own author can still ask
questions in their own room (there's a legitimate reason to playtest
phrasing) but a `kind: 'guess'` from `author_session_id` is rejected
server-side with a notice rather than silently auto-solving the room they
already know the answer to.

**Scope cuts, recorded rather than silently decided**: lobby cards show the
*host's* identity plus a live player count, not every member's avatar (an
N-avatar live-sync cost per card for little value); "transfer host" is a
manual button, no automatic failover if a host goes offline (a `waiting`
room with an absent host is a known limitation); a room's name is set once
at creation, no rename page; "play again" after solving stays open to
anyone rather than host-gated, since it creates a brand new room and never
touches the solved one — gating it would add friction with no safety
benefit.

**A real test bug, not just new coverage**: `transferHost`'s route validated
the target was "a current member" against `listMembers()` — the *live SSE
connection* set, not the durable `room_participants` table. In a black-box
HTTP test that never opens an `EventSource`, that set is always empty, so
the transfer silently no-opped and a host-only-gated follow-up request
succeeded when it should have failed. Root cause was conflating "currently
has an open connection" (what the online count and presence roster mean)
with "has ever joined this room" (what membership for a permissions check
should mean) — fixed by checking `room_participants` directly
(`isParticipant()`), not by loosening the test.

## A theme and layout pass, same priority as the functional work

The same review asked for a visual rework (a navy/cream/gold "detective"
palette, a condensed lobby header instead of a tall hero block, a
multi-column responsive lobby grid, and a two-column room layout) alongside
the host/puzzle-authoring work above — the user set these as equal priority
rather than sequencing one after the other.

Kept the same four CSS custom properties (`--fg`, `--bg`, `--accent`,
`--border`) rather than introducing new ones: every component already
written against them (from the very first commit through today's work)
repaints under the new palette with zero per-component changes, in both
`prefers-color-scheme` modes. The lobby's `.lobby-list` and room's `.room`
both move from a single flex column to CSS Grid with a `@media
(min-width: ...)` breakpoint — 1/2/3 columns for the lobby, a content column
plus a 16rem members sidebar for a room — using plain grid auto-placement
(no `order`/named `grid-area` tricks), so DOM order and visual order stay
identical: a screen reader or keyboard tab sequence sees the same order a
sighted mouse user does, matching the project's own keyboard-first quality
bar. The ask-form uses `position: sticky; bottom: 0` within its own column
rather than `position: fixed` on the viewport, so it stays reachable near
the bottom while scrolling a long transcript without overlapping the
sidebar or breaking on a narrow screen.

**Not verified in an actual browser** — this environment has no GUI browser
and the one available headless Chromium build (`chromium-1243`, already
cached from a prior Playwright use) is missing a system shared library
(`libnspr4.so`) that isn't installable without `sudo` access this session
doesn't have passwordless. Verified instead via the rendered HTML structure
directly (grid containers, sidebar nesting, breakpoint rules) and the
existing `pnpm check` suite, which exercises every page's markup but not its
rendered layout. A real resize-mid-interaction and keyboard-tab-order pass
in an actual browser is recorded as still outstanding, not assumed done.

## The live app was down, not just serving a stale mock judge

Checking in on the deployed site turned up something worse than the open
`GROQ_API_KEY` item below: every `/rooms/:code` page returned 500, and the
Fly machine's own status was `stopped` — not asleep from `auto_stop_machines`,
but parked there because the app process had crashed on boot 10 times in a
row and Fly gave up restarting it. `flyctl logs` (needed `flyctl auth login`
first, since no Fly token had ever been configured for this specific repo —
a token for a different week's repo isn't valid here, each is scoped to one
app) showed the exact failure: `FOREIGN KEY constraint failed` inside
`seedPuzzlesIfEmpty()`'s `DELETE FROM puzzles`.

Root cause, confirmed by reading `/data/app.db` directly over `flyctl ssh
console` (the runtime image has no `sqlite3` CLI, so this used `node:sqlite`
— the same module the app itself uses — rather than installing a new tool):
a `rooms_old` table was still sitting on the volume, left over from
`ensureRoomsHaveWaitingStatus()`'s rename-recreate-copy-drop migration
(`76be42c`, the host-roles commit). That function's final `DROP TABLE
rooms_old` never ran on a prior boot — the process crashed before reaching
it — and the function's own "already migrated?" check only looks at whether
`rooms` has the new schema, so every later boot skipped the migration branch
entirely and never got a second chance to clean up the leftover table.
`rooms_old`'s `puzzle_id` column still carries its own `REFERENCES
puzzles(id)`, so SQLite enforces that constraint against `rooms_old`'s rows
on *any* `DELETE FROM puzzles` — the seeding reconciliation already
documented above — regardless of whether the app's own code still reads
from that table. Six rooms were trapped in `rooms_old`, invisible to the
real `rooms` table but still blocking every boot.

Fixed by making the "already migrated" branch also unconditionally
`DROP TABLE IF EXISTS rooms_old` before returning, so a crash mid-migration
self-heals on the very next boot instead of wedging the app in a permanent
restart loop. Reproduced the exact crash first against a throwaway database
seeded with the same broken shape (new `rooms` schema + a leftover
`rooms_old` referencing `puzzles`), confirmed the old code crashes on it and
the fixed code boots clean and leaves `rooms_old` gone — not just inferred
from the production stack trace. The six trapped rooms had no real
transcript or participant data (`qa_entries`/`room_participants` were both
empty under the new schema; the only real user data on the volume,
446 sessions' nicknames/avatars/bios, was untouched throughout), so nothing
of value was lost by letting the self-heal drop them.

## The first fix was incomplete, and made the outage worse before fixing it

Deploying the `DROP TABLE IF EXISTS rooms_old` fix above took the app from
"crash-looping, serving nothing" to "crash-looping with a different error" —
`no such table: main.rooms_old` — which meant the app was *still* down
immediately after a fix that had been reproduced and verified locally. The
gap: I'd verified the fix against a throwaway DB with `rooms_old` holding
rows, but `room_participants`/`qa_entries` empty — accurate to what the
reconciliation path's crash looked like, but not what dropping `rooms_old`
itself would expose next on the real volume.

Querying `/data/app.db`'s schema directly (not just its row counts, which is
as far as the first investigation went) surfaced the actual shape: SQLite's
`ALTER TABLE rooms RENAME TO rooms_old` doesn't just rename that one table —
it silently rewrites *every other table's* `REFERENCES rooms(id)` clause to
point at `rooms_old` instead, since SQLite's rename follows the reference.
`76be42c`'s migration never re-pointed `room_participants`/`qa_entries`
afterward, so their schema has said `REFERENCES "rooms_old"(id)` since that
commit — invisible the whole time `rooms_old` still physically existed to
satisfy it. Dropping `rooms_old` turned an inert latent bug into an active
one: both tables now referenced a table that didn't exist, and SQLite
enforces that on any write to them, even an empty `DELETE`.

Rebuilt this reproduction more carefully before trusting a second fix:
seeded a throwaway DB with the *exact* schema found on the volume (`rooms_old`
with rows, but the children's DDL — not just their data — carrying the
dangling `"rooms_old"` reference), confirmed the committed fix crashed on it
with the identical `no such table` error seen in production, then added
`repointRoomIdForeignKey()` — rebuilds `room_participants`/`qa_entries` in
place (rename, recreate from the same DDL with `"rooms_old"` swapped for
`rooms`, copy every row, drop the renamed original) before `rooms_old` is
ever touched, so neither table's FK can go stale no matter what happens to
that table afterward. Verified against the same reproduction: clean boot,
schema correctly reads `REFERENCES rooms(id)` on both tables afterward, and
a full create-room → start → ask-a-question flow against it all returned
the expected statuses with no crash — not just a boot that doesn't throw.
Also reran it a second time against its own already-fixed output to confirm
the repoint is a one-time no-op once applied, not something that re-triggers
every boot.

The standing lesson, not just this bug: verifying a database migration fix
against a reproduction that matches *symptoms* (the crash message, the row
counts) isn't the same as matching the actual schema on disk. The second
investigation read `sqlite_master.sql` directly instead of inferring shape
from behavior, and that's what caught the dangling FK the first pass missed.

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

## Phase 1 of the tanghenre.com-inspired refresh

A new brief asked for several things at once, scoped so the core idea (a
multiplayer, AI-judged 海龟汤 room) stays the thing being improved, not
diluted: an original-art homepage rebuild in the spirit of tanghenre.com
(paper/mystery feel, clear play-in-three-steps, case library preview) without
copying its imagery, brand, or bulk puzzle content; a real cumulative
"reasoning time" stat; non-destructive SQLite migration guarantees; lobby and
room UX fixes; and fixing the open `GROQ_API_KEY` item properly instead of
just restating it as still-open. Built and committed as five independent,
individually-tested changes rather than one large one, per this repo's own
git-discipline rule.

### Homepage rebuild
[`116fc38`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/116fc38)
replaced the old two-line hero with: an original inline-SVG illustration
(a bowl, rising steam, a question mark, a magnifying glass — hand-drawn
`<path>`/`<circle>` shapes, not traced or downloaded art) sized and colored
from the site's own `--accent`/`--fg` variables so it repaints correctly in
dark mode for free; a three-step "how it plays" explainer; an FAQ answering
the two questions a design brief specifically warned against mis-answering
(there IS a single solution, there is NO fixed question limit — both
correct in the FAQ's own wording); a "from the case library" preview drawn
from `listAvailablePuzzles()` (same function the room-creation picker uses,
so it can't leak a solution — it never selects that column); and the
required content warning, in the brief's own Chinese wording plus an English
gloss ([`ae53b82`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/ae53b82)
fixed a first pass that had paraphrased it in English only).

### Reasoning-time accounting
Also in `116fc38`. The brief's hardest constraint: real time, counted from
zero as of this feature (no backfilled history, no borrowed reference-site
number), deduped per anonymous session across tabs/rooms, server-trusted
rather than client-reported, and immune to idle/background/restart padding.

Design, each point verified against a live local server, not just reasoned
about:
- **Unit of dedup is a session, not a (session, room) pair.** One
  `session_activity` row per `session_id` (src/db.ts) means a heartbeat from
  ANY tab or room for the same session advances the same cursor. Verified:
  two simultaneous rooms under one session, 3-4s of real elapsed time
  between them, credited the gap exactly once — not twice.
- **The server's clock decides value, not the client.** A heartbeat POST
  carries only an optional `resume: 1` flag (asserting "I just came to
  foreground," which can only cost credit by resetting the baseline, never
  manufacture extra) — never a duration. `recordHeartbeat()` computes
  elapsed time from `Date.now()` minus the stored cursor.
- **Idle/background/restart never retroactively credited.** A gap >= 5
  minutes moves the cursor to now without crediting anything — verified by
  backdating a session's cursor by 10 simulated minutes and confirming the
  total stayed at 0, then confirming a subsequent real 4s gap credited
  correctly.
- **Only credits while a room is `active`.** Checked against both `rooms`
  and `room_participants` server-side on every call — verified a
  non-participant and a `waiting`-status room both get 403, not silent
  non-credit.
- **A lightweight same-origin check** (`sec-fetch-site` / `Origin`,
  `isSameOrigin()` in `src/routes/rooms.ts`) rejects a forged cross-site
  heartbeat, layered on top of the existing `SameSite=Lax` session cookie —
  this is the first endpoint fired automatically and repeatedly rather than
  once per deliberate form submit, so it gets an extra check the other POST
  routes don't need.

`spec/reasoning-time.test.ts` exercises all of this with real multi-second
sleeps against the live app (same pattern as `spec/sse.test.ts`'s presence
checks): rejects a non-participant, a `waiting` room, a forged `Origin`;
confirms a real ~3s gap credits ~3s, not an arbitrary number; confirms two
rooms under one session don't double-count an overlapping gap.

### Stopping the silently-faked AI judge
[`5b095f4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/5b095f4)
finally root-caused the open item from the previous entry above, rather than
just re-flagging it. `src/llm.ts`'s `judge()` treated "no `GROQ_API_KEY`" as
"use the mock" unconditionally — which is exactly right for CI/local testing
and exactly wrong for a production deploy that forgot to set the Fly secret,
since both looked identical from the outside. Split into three states
(`judgeAvailability()`): `real` (key set), `mock` (no key, but
`ALLOW_MOCK_JUDGE=1` explicitly set — what CI's Docker run and local dev now
set), and `unavailable` (neither — what an actually-misconfigured production
deploy now correctly shows: "The AI judge isn't configured on this deploy,"
never a fabricated verdict). `.github/workflows/checks.yml` and README.md
updated to match. `spec/llm-availability.test.ts` exercises all three states
directly (the "neither set" state can't run through the live test server,
which always carries `ALLOW_MOCK_JUDGE=1` the same way production always
carries a real key — so this one test file calls `src/llm.ts` directly
rather than over HTTP, the one deliberate exception to every other spec
file's "test against the running app" pattern).

This was NOT verified against the live Fly deploy — no secret was read,
set, or deployed, per this session's authorization boundary. The fix is
verified to be correct against local runs in all three states; whether the
production machine's `GROQ_API_KEY` is actually set is still something only
`flyctl secrets list -a comp4020-final-yanzzzzzzzz` (not run this session)
can answer. Not claiming the live site is fixed — only that the code no
longer contains the bug that caused what was observed there.

### Lobby/room UX fixes
[`0cee40a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/0cee40a):
- **Multi-tab online-count dedup.** `connectionCount()`/`listMembers()` in
  `src/sse.ts` counted every open SSE connection, so one person with two
  tabs on a room showed up as two people — in the room sidebar, the lobby
  card's player count, AND crit-9's member-list feature, all three reading
  from the same function. Fixed by deduping on `session_id` wherever a
  channel carries one (every room does). Verified live (two streams, one
  session cookie, "1 person online," stays 1 after closing one of the two)
  and with a new `spec/sse.test.ts` case.
- **Copy-code / copy-link feedback**, since the brief specifically called
  out needing success/failure feedback for sharing a room, not just a
  visible code to select by hand.
- **A friendly case-not-found page** for `GET /rooms/:code` specifically —
  the one room-code route a person actually types (the "Have a code?" box,
  a mistyped link) — rather than Hono's bare 404. Every other room-code
  route is only reached by clicking something the app already rendered, so
  those keep the plain 404 (not a user-facing typo path).
- **Visible "reconnecting" state** for the room's SSE connection
  (`EventSource.onerror`/`onmessage`), since a drop (Fly's auto-stop/start
  cycle, an ordinary network blip) reconnects silently on its own and
  previously looked, to someone watching the page, identical to a stuck one.

### A migration-safety bug found while verifying migration safety
[`7965107`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/7965107).
The brief's migration requirement ("verify with a local old-schema fixture
that it preserves data") is what surfaced this: building a fixture from the
exact schema the UNMODIFIED, already-committed `src/db.ts` would have left
on disk, seeded with a real room/participants/transcript/authored puzzle,
and migrating it through that unmodified code wiped every one of those rows
on the very next boot. Not a bug this session introduced — present since
`76be42c` (player-authored puzzles), latent because nobody had tested a
restart against a database holding one.

Root cause: `seedPuzzlesIfEmpty()` reconciled the whole `puzzles` table
against `SEED_PUZZLES` by set-equality and wiped `qa_entries`,
`room_participants`, `rooms`, and `puzzles` entirely on any mismatch. Its own
comment claimed that only happens "when the puzzle bank itself changed
underneath existing rooms" — but a single player-authored puzzle also
breaks set-equality, since it's a row `SEED_PUZZLES` doesn't have, with no
code change needed to trigger it on the next restart of any database that
ever saw one authored puzzle.

Fixed with a purely additive `seedMissingPuzzles()`: only ever `INSERT`s a
missing `SEED_PUZZLES` entry among OFFICIAL puzzles
(`author_session_id IS NULL`), never deletes a row, and never touches an
authored puzzle. Verified three ways — reproduced the bug against the old
code with a fixture, confirmed the fix preserves every row when the same
fixture is booted through it (a real server, real HTTP responses checked),
and encoded the same sequence as `spec/migration.test.ts`, confirmed it
fails against the old code and passes against the fix.

### Backup / migration / rollback procedure for `/data` on the live app
Not run this session (production `/data` is out of this session's
authorization boundary — no deploy, no production DB access), but recorded
here since the brief asks for the steps to be written down:

1. **Backup**: `flyctl ssh console -a comp4020-final-yanzzzzzzzz`, then copy
   `/data/app.db` off the machine (e.g. `flyctl ssh sftp get /data/app.db`
   from the local machine, or `cat /data/app.db | base64` over the console
   and decode locally if `sftp` isn't available) before deploying a change
   that touches `src/db.ts`. WAL mode is on (`PRAGMA journal_mode = WAL`),
   so also copy `app.db-wal` and `app.db-shm` if present, or run
   `PRAGMA wal_checkpoint(TRUNCATE);` first to fold them into the main file.
2. **Migrate**: deploy as normal (`flyctl deploy`, or CI's push-to-main
   path once public) — every migration in `src/db.ts` runs automatically at
   process start, against whatever's on the mounted volume, and is written
   to be idempotent (checked via `ensureColumn`'s existing-column check, the
   rebuild functions' "already migrated?" `sqlite_master.sql` check) so a
   re-run or a crash-and-retry mid-migration is safe to just let happen
   again.
3. **Verify**: hit the deployed URL's `/` and a known room's `/rooms/:code`
   immediately after the deploy settles; `flyctl logs` for any migration
   error (the pattern from the `e1bc624`/`26c13e7` incidents above).
4. **Rollback**: if a migration leaves the database in a bad state, restore
   the backed-up `app.db` (`flyctl ssh sftp shell` to put it back, or the
   base64 round-trip) and `flyctl releases rollback` to the previous image,
   since a newer image's code may not know how to read an older schema it
   never migrated away from. Rolling back the image WITHOUT also restoring
   the backup only works if the migration that ran was non-destructive to
   begin with (true for everything in this repo's migrations, per the
   additive-only design above and the pre-existing non-destructive rename
   migrations) — restoring the backup is the belt-and-suspenders step for a
   migration that turns out not to be.

## Phase 2: a live-sync bug report interrupted the Chinese/visual rework

A new brief asked for two things at once, with the user explicitly
prioritizing the second over the first: continue the tanghenre.com-inspired
visual rework and translate every main user flow to Simplified Chinese, but
first fix a concrete report that another browser creating a room needed a
manual refresh to appear in the lobby, and a room's own state/transcript
didn't update live either. Root-caused and fixed the live-sync report first,
per this repo's "find the root cause before retrying" rule — it's a
regression in the thing the brief is graded on (real-time), not a cosmetic
gap, so it came before the visual/translation work rather than after.

### Chinese translation, with a migration-safety catch
[`fd32672`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/fd32672)
rewrote the nine built-in puzzles' title/premise/solution natively in
Chinese (not machine-translated from the English versions), plus the
auto-generated labels that appear in every room regardless of puzzle content
(`Anonymous Detective#N` → `匿名侦探#N`, `Unknown host` → `未知房主`,
`Anonymous author` → `匿名作者`).

The real risk, caught before shipping it: `seedMissingPuzzles()` reconciled
official puzzles by exact `(title, premise, solution)` text equality (added
in the prior session's migration-safety fix, [`7965107`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/7965107)).
Rewriting that text in code would make every rewritten puzzle look like a
*new* row on the next boot — not the data-loss bug `7965107` fixed, but a
real content-drift bug: translating the seed data wouldn't update anything a
real room already points at, since its `puzzle_id` would still reference the
old English row sitting unchanged alongside a new Chinese duplicate. Fixed
by giving each `SeedPuzzle` a stable `slug` or (`src/data/puzzles.ts`), and
rewriting the reconciliation as `reconcileSeedPuzzles()`: matches existing
rows by slug, UPDATEs in place rather than ever inserting a duplicate for an
already-known puzzle, and backfills `slug` once for any pre-slug row by
its known legacy English title. Verified directly, not just by reasoning
about it: built a throwaway pre-slug fixture (the exact old schema, an
English "The Elevator Routine" puzzle row, a real room pointing at its
`puzzle_id`), booted it through the new code, and confirmed the row's `id`
and the room's `puzzle_id` were both unchanged afterward while the puzzle's
own text flipped to Chinese — no duplicate row, no orphaned room, official
puzzle count stayed at 8.

### Reproducing the live-sync report before touching any code

The user's report named three symptoms (lobby needs a manual refresh; room
state isn't live; can't see others' questions/answers) plus a prior
read-only review's suspicions (no lobby snapshot/reconnect catch-up, no
dedicated room-status broadcast, `pagehide` closes the stream but nothing
reopens it on `pageshow`, a possible message-loss window around
subscribe-vs-snapshot ordering). Treated the suspicions as hypotheses to
verify, not a ready-made fix list — reproduced each claim first against a
real, isolated local server (port 8081, its own throwaway SQLite file under
`.data-test-8081/`, never the user's own port-8080 preview or its data)
before writing any fix:

- **Lobby race, confirmed real**: fetched `GET /`, created a room in a
  *separate* session, then opened `/lobby/stream` — the new connection
  received nothing. `/lobby/stream` only ever broadcast "here's the one
  room that just changed," with nothing resent for anything missed; a room
  created in the gap before a tab's `EventSource` finishes opening (real
  network/JS-eval latency, or any reconnect after Fly's auto-stop/start
  cycle drops the connection) was lost permanently, not just delayed.
- **Room-status silence, confirmed real**: loaded the REAL rendered room
  page and the REAL `public/client.js` into `jsdom` with a genuine
  `EventSource` (Node 24's `--experimental-eventsource`, not a mock) for two
  independent cookie sessions in the same room, had the host start the
  case, and watched session B's page: no ask-form ever appeared without a
  manual reload. `POST /rooms/:code/start` and `/transfer-host` only ever
  redirected the requesting session; nothing was broadcast on the room's own
  SSE channel for anyone else already watching.
- **Question/answer delivery: NOT broken** — the same two-session `jsdom`
  harness showed A's question reaching B's transcript and vice versa inside
  ~1s, both directions. Recorded as "checked, found working" rather than
  silently assumed, since the report bundled it with the two real bugs above.
- **Ask-form swallows a rejection, confirmed real** (found while reading the
  code, not from the report or the prior review): `public/client.js`'s
  ask-form `fetch()` call follows the server's 303-on-rejection
  (cooldown/not-started/author-guess) redirect transparently — `fetch`'s
  default `redirect: "follow"` means `res.ok` is `true` either way.
  Reproduced directly: posted two questions back-to-back (the second lands
  inside the 5s cooldown) and confirmed the final response looks identical
  to a success from the client's point of view, with the rejected question
  silently absent from the transcript.
- **`Last-Event-ID`/`Date.now()`-based presence/judging ids: checked and
  ruled out.** The server only ever reads the `?after=` query param for
  replay, never `Last-Event-ID`, so non-monotonic ids on those two event
  types create no actual cursor-pollution risk today — recorded here so
  it isn't silently "fixed" as churn on a non-issue, but also isn't lost as
  an unexamined claim.

### The fix
[`20e5aba`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/20e5aba):

- **`/lobby/stream` sends an authoritative snapshot on every connect.**
  Instead of only pushing incremental "a room changed" events, the instant
  any connection opens (first load, or any reconnect) it sends the full
  current list as a `"snapshot"` event; `public/lobby.js` reconciles its
  rendered list from that rather than trusting it already caught every
  individual event since some earlier point in time. This is what actually
  closes the race — no single missed event can leave the page stale forever,
  because every (re)connection re-synchronizes from ground truth.
- **A `"room-status"` broadcast on start and transfer-host**, plus a
  `"lobby-update"` push of that room's lobby card (so a homepage viewer sees
  the waiting → in-progress flip too, not just someone on the room page
  itself). The client's handler reloads the page on receipt — the simplest
  correct way to pick up the now-different waiting/active markup (the
  ask-form's presence, the waiting notice, the host badge) without
  duplicating every render branch into JS a second time.
- **The ask-form reads the final response's own URL for a `?notice=`
  param** (the same signal a full-page-reload submit would show via its
  address bar) instead of trusting `res.ok`, and shows it in a new
  `#ask-notice` element — deliberately *not* clearing the input on
  rejection, since that's the one case where the player's typed text should
  stay for a retry, not vanish.
- Two smaller fixes found while in this code reading it, not from the
  report: `/rooms/:code/stream` now calls `subscribe()` *before* reading the
  transcript snapshot, not after — the old order had a real (if narrow) gap
  where an entry inserted between the snapshot read and subscribing landed
  in neither; the new order can at most double-deliver an entry inserted in
  the now-much-smaller reversed window, which `client.js`'s existing `seen`
  id-set already drops silently. And both `client.js` and `lobby.js` now
  reconnect their `EventSource` on `pageshow` with `persisted: true` (a
  back/forward-cache restore) — `pagehide` already closed it, but nothing
  previously reopened it, so navigating back into a room or the lobby via
  the browser's own back button silently left the page frozen.

### Verifying it without a GUI browser
No GUI browser is available in this environment (same constraint noted in
Phase 1's theme-pass entry above). Used `jsdom` with Node 24's real
`--experimental-eventsource` implementation instead of a mocked DOM or a
reimplementation of the client logic — this loads and executes the actual
shipped `public/client.js` / `public/lobby.js` against the real rendered
HTML, so a JS error, a bad selector, or a script that silently never runs
would have shown up as a test failure, not just a server-side SSE check
(every `spec/*.test.ts` file before this session checked the server side of
real-time by reading the raw SSE wire format; none loaded the actual
client-side JS). `spec/live-sync.test.ts` encodes six of these checks as a
permanent regression suite: lobby live-update, the lobby snapshot/race fix,
a lobby card's live status flip, the room-status broadcast on start,
cross-session question delivery, and the ask-notice rejection fix.
`package.json`'s `test` script now sets `NODE_OPTIONS=--experimental-eventsource`
so this runs the same way in CI's Docker-based `pnpm check` as it does
locally, with no separate CI-only code path.

Full suite after the fix: 35/35 passing, `pnpm typecheck` clean, against the
isolated port-8081 server with its own throwaway database — confirmed via
the same ad hoc repro scripts used to first reproduce each bug, kept under
`.data-test-8081/` (matches `.gitignore`'s existing `.data*/` pattern, never
committed) and deleted once their findings were captured here and in the
permanent test file. The user's own port-8080 preview process and its
database were never stopped, restarted, or touched.

Not done in this pass, carried forward: the Simplified Chinese translation
of UI chrome/navigation/forms (only the puzzle content and auto-labels were
translated so far, as part of the migration-safety work above) and the
visual "案件馆" (case-file) theme rework — resuming both now that the
live-sync report is fixed and regression-tested.

## Reversing course: back to English, for the whole app

A new instruction explicitly superseded the Chinese direction above: translate
every piece of first-party content back to English — the nine puzzles'
title/premise/solution, the auto-generated anonymous-detective/host/author
labels, the content-warning line, home.ts's step headings, and README's
intro — and ship it, not just change the plan. This is a deliberate reversal
of the "Chinese translation" entries two sections up, recorded here rather
than silently overwritten: the brief doesn't fix a language, and the user's
latest, more specific instruction governs over the session that came before
it. The Chinese visual-theme rework that was "carried forward" above is
explicitly out of scope for this pass — continuing it was ruled out in favor
of finishing the language flip and getting it live
([`115d992`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/115d992)).

**Scope boundary, held deliberately**: user-authored puzzle stories,
nicknames, avatars, bios, and every historical transcript/chat entry already
in the database are untouched — translating those would mean silently
rewriting somebody's own words, which this instruction never asked for and
this app has no business doing. Only two kinds of first-party content
changed: puzzle *reference* content tracked in git (`src/data/puzzles.ts`,
the same file `reconcileSeedPuzzles()` already treats as code, not user
data — see the slug-reconciliation entry above) and auto-generated system
strings with no author (`"Anonymous Detective#N"`, `"Unknown host"`,
`"Anonymous author"`, the content-warning copy). Both were already proven
safe to resync without touching real rooms: the Chinese-translation entry
above built exactly this mechanism (`reconcileSeedPuzzles()`, keyed by a
`slug` that never changes across a text edit) specifically so this reversal
wouldn't need a new migration or a fresh data-loss risk — translating the
seed content back to English is the same operation, run in the other
direction, over a mechanism already regression-tested in
`spec/migration.test.ts`.

**Verification, not just a reasoned argument**: ran the full suite (35/35)
and `pnpm typecheck` against an isolated local server on port 8081 with its
own throwaway SQLite file (`.data-test-8081/`, gitignored, never the user's
own port-8080 session), confirmed `pnpm build` produces a clean bundle, then
fetched the live rendered homepage/readme/room-creation pages from that
server directly and confirmed no Chinese character remained in any of them
(a simple `\p{Script=Han}` regex over the fetched HTML, not just reading the
diff).

### Shipping it: a real production backup before touching the live database

The brief's persistence requirement, and this task's explicit authorization,
both call for backing up `/data` before a migration-touching deploy — this
one reconciles `puzzles` in place via `reconcileSeedPuzzles()`, the same code
path that already changed real rows once before (the Chinese translation
itself). Woke the Fly machine first (`auto_stop_machines` had it asleep —
one plain `fetch` to the live URL, not a special wake command), then ran a
real **SQLite backup API** call over `flyctl ssh console` using `node:sqlite`'s
own `backup()` function — not a raw copy of `app.db`, which would have missed
whatever was still sitting in `app.db-wal` (WAL mode is on; the live file had
a 4 MB WAL at backup time) and risked copying a file mid-write. The backup
landed as `/data/app.db.backup-pre-english-deploy`, verified immediately by
opening it read-only and checking real row counts (2 rooms, 8 puzzles, 768
sessions, 8 qa_entries) before deploying anything — confirming the backup
file itself was a complete, queryable snapshot, not an empty or truncated
one. Left in place on the `/data` volume afterward (not deleted, not copied
off into this repo or anywhere else) as the actual rollback artifact per the
procedure already written up above, and specifically **not** pulled down to
a local machine or uploaded elsewhere, since production user data leaving
Fly's own volume was explicitly out of scope for this task.

Deployed with `flyctl deploy --remote-only --ha=false -a
comp4020-final-yanzzzzzzzz` (the same command `fly.toml`'s own comment
documents for a private-repo manual deploy) via `mise exec -- flyctl`, using
the course-provisioned token already sitting in the gitignored
`mise.local.toml` — never read or printed in this session, only used as
`flyctl`'s own ambient auth. The build and rolling machine update both
reported healthy; Fly's post-deploy DNS check timed out once (a transient
resolver blip against `8.8.8.8`, not an app or deploy failure) and the site
was independently confirmed reachable seconds later anyway.

**Verified against the live deploy, not just the build log**: fetched
`https://comp4020-final-yanzzzzzzzz.fly.dev/`, `/readme/`, and `/rooms/new`
directly — all three 200, all three free of Chinese characters. Then,
separately, read the production database directly over `flyctl ssh console`
(not inferred from the app behaving correctly) and confirmed every row
survived: the same 2 rooms, 8 puzzles, 8 qa_entries, both rooms' `puzzle_id`
foreign keys still resolving to a real row, and the 8 official puzzle titles
now reading in English (`"A Bowl of Turtle Soup"`, etc.) in place — not a
new row, not a duplicate, not an orphaned `puzzle_id` — matching exactly what
`reconcileSeedPuzzles()`'s slug-keyed UPDATE is designed to do.
`sessions` had grown from 768 (at backup time) to 774 by the time this was
checked — real traffic between the backup and this check, not data loss.

Not done in this pass: the GitHub Actions `checks`/`deploy` workflow didn't
run for this push, since the repo is still private (`checks.yml`'s own `if:
!github.event.repository.private` guard) — this session's `gh run list`
calls were denied by this environment's permission policy before that could
even be confirmed from the Actions UI, so the manual `flyctl deploy` path
above was the one actually exercised and verified, consistent with
`fly.toml`'s own documented behavior for a private repo.

## A shorter About, and a real case browser

Two user-reported problems, fixed and deployed together: `/readme/` (the
full technical README) was the site nav's only "About" link, so a player
had to read stack/CI/Fly/database detail just to learn how to play; and the
homepage's "Start a new case" and "Browse every case" buttons both pointed
at `/rooms/new`, so "browse" never actually showed anyone what was playable.

**Short About page**
([`d1b4fb0`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/d1b4fb0)):
added a real `/about` route — title, a one-line premise, the three-step
loop (read the premise, ask the shared AI judge yes/no/irrelevant questions,
solve it together and submit a guess), how a room starts, the content
warning, and two entry points (`Start a new case` / `Back to lobby`) — no
stack, CI, Fly, database, course brief, or code. `/readme/` keeps serving
`README.md` verbatim unchanged (`spec/invariants.test.ts`'s heading-order
check is untouched — it checks `/readme/`, never `/about`), just relabelled
"Technical documentation" in its own `<title>` and linked from `/about`'s
footer for anyone who wants it. The site nav's `About` link moved from
`/readme/` to `/about` in `layout.ts`, the one shared template every page
renders through, so this is a one-line nav change, not a per-page edit.
Said "AI acts as a shared judge when available" rather than naming Groq or
implying the judge is always configured — matches the real
`judgeAvailability()` states (`real`/`mock`/`unavailable`) documented above
without exposing which one is live.

**`/cases`, and actually wiring the preselect it needs**
([`c5290c3`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/c5290c3)):
root cause of the duplicate-link bug was literal — `home.ts`'s "Browse every
case" `<a>` had just never been pointed anywhere but `/rooms/new`, the same
href "Start a new case" uses. Fixing the link alone would have made
"browse" silently do nothing new, so built the page it should have pointed
at: `/cases` lists every shared/built-in puzzle's title, full premise, and a
real author-or-official label, with a `?q=` search (length-capped at 80
chars, `%`/`_` escaped before going into `LIKE`, input HTML-escaped on the
way back out, a plain "no cases match" empty state) — all through
`listAvailablePuzzles()` unchanged in shape (same columns, so it still
structurally cannot select `solution`), just given an optional search
filter. Visibility is identical to the existing room-creation picker's,
reusing the same function rather than a second query someone could let
drift out of sync with it.

Each card's "Play this case" goes to `/rooms/new?puzzleId=<id>` — which
turned out to accept that query param already (`room-new.ts`'s
`PuzzleOption` rendering) but never actually read it, so the link worked but
silently did nothing. Wired `rooms.get("/rooms/new", ...)` to read
`?puzzleId=`, re-validate it against `isPuzzleAvailable()` (the exact check
`POST /rooms` already enforces for a client-supplied id) before passing it
through as `selectedPuzzleId`, and render it as the `<option>`'s `selected`
attribute. The re-validation is the real decision here, not a formality: a
`?puzzleId=` pointing at a private authored puzzle, or at a nonexistent id,
falls back to no selection rather than preselecting — or, worse, confirming
the existence of — a puzzle the requester shouldn't be able to see from a
bare GET with no session check on it otherwise.

Verified against an isolated local server (`PORT=8082`, its own throwaway
`DATA_DIR`, the user's own 8080/8081 processes never stopped or touched):
created a private authored puzzle and confirmed its title appears on
neither `/cases` nor the `/rooms/new` picker; confirmed `?q=turtle` matches,
an unmatched query reports "no cases," and a `<script>` payload comes back
escaped; and — the one check that actually proves the preselect isn't
cosmetic — fetched a real puzzle's id from the picker, loaded
`/rooms/new?puzzleId=<id>`, confirmed the option rendered `selected`, then
actually submitted the existing-case form and read the created room's own
page to confirm it was running that exact puzzle, not just that the HTML
looked right. `spec/about.test.ts` and `spec/cases-browse.test.ts` encode
all of the above as a permanent regression suite (9 new tests); full suite
ran 44/44 across 11 files, `pnpm typecheck` and `pnpm build` both clean,
all against the isolated 8082 server.

**Deploy**: `flyctl deploy --remote-only --ha=false -a
comp4020-final-yanzzzzzzzz` via `mise exec -- flyctl`, same command and
auth path as the prior manual deploy above. This pass touches no schema and
no existing row — `/about` and `/cases` are new read-only routes, and
`listAvailablePuzzles()`'s SQL change only adds an optional `WHERE` clause
to an existing `SELECT` — so no `/data` backup was taken before this deploy
(nothing migration-shaped to protect against). The machine reported healthy
after the rolling update; Fly's own post-deploy DNS check timed out once
(`read udp ...->8.8.8.8:53: i/o timeout`) — the same transient resolver
blip already seen and independently confirmed harmless in the prior deploy
entry above, not an app or deploy failure.

Verified live, not just from the build/deploy log: fetched
`https://comp4020-final-yanzzzzzzzz.fly.dev/`, `/about`, `/cases`, and
`/readme/` directly and got 200 from all four; parsed the live homepage's
own rendered HTML and confirmed the nav's `About` link resolves to `/about`
and `Browse every case` resolves to `/cases` (not `/rooms/new`) on the
actual deployed site, not just in the local test server.

## A real nav/community/music pass, scoped to local-only this session

This session's explicit authorization was narrower than every prior one in
this file: local changes, local tests, and commits only — no `git push`, no
`flyctl deploy`, no production database access, no reading `mise.local.toml`.
That boundary overrides this repo's own CLAUDE.md "push every commit
immediately" rule for the duration of this session; every commit below sits
on `main` locally, unpushed, by explicit instruction. Five commits, each
independently green (`pnpm check` + `pnpm build` run against its own
isolated checkout before the next commit started), not one combined diff.

### Nav rework and an opt-in, honestly-stated music toggle
[`6097931`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/6097931),
fixed by
[`60ed5d0`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/60ed5d0).

Modeled on tanghenre.com's structure (an icon+wordmark brand linking home,
a small top nav, no login button) without copying any of its art or copy:
an original inline-SVG bowl-with-steam icon (hand-drawn `<path>`s colored
from the site's own `--accent`/`--fg` variables, not traced or downloaded)
replaces the old text-only "Turtle Soup Puzzle Room" wordmark and links back
to `/`. The single old `About` nav link became a real three-item nav (Home /
Case Library / Community), each marked `aria-current="page"` and an
`.active` style when it's the current page — `layout()` now takes an
optional `activePath` parameter every page-render function threads through.
No Login control exists, consistent with this app never having had
accounts; the existing nickname/profile link stays in the header (now inside
a `.site-controls` group) specifically because the brief's multi-user
requirement needs players to stay identifiable to each other, which a
Login-free session already provides. `/about` moved to a new site footer,
next to the existing `/readme/` link it was already logically paired with
on `/about`'s own page.

**Music**: the user supplied the verified source in-prompt — "Creepy Ambient
Loop" by epb9000, CC0 1.0, direct file
`https://opengameart.org/sites/default/files/creepyloop-v2_0.ogg` — with
explicit authorization to download and self-host it. Fetched that one URL
directly with Node's own `fetch` (no `curl`/`wget`, avoiding this session's
shell-prefix permission friction), checked the HTTP status and the file's
own "OggS" magic-byte signature (not trusted on `Content-Type` alone, since
a redirect-to-HTML-error-page would still claim success otherwise) before
writing it to `public/audio/creepy-ambient.ogg`. `ASSET_LICENSES.md` records
author/source/direct-file/license/date; `/about` gained a "Music credits"
section linking it.

The toggle (`public/music.js`) defaults off and only ever reports "on"
after a real, resolved `audio.play()` — a rejected promise (an autoplay
restriction, an unsupported format) leaves the button at "off" with a
readable status message instead of silently pretending playback started.
A `canPlayType('audio/ogg; codecs="vorbis"')` check disables the whole
control with an explanation if the browser can't play OGG at all; no
`ffmpeg`/encoder was available in this sandboxed environment to produce a
second-format fallback file, so graceful degradation (disabled + explained)
is what ships instead of a silently broken button. The preference persists
in `localStorage`, failing safe to "off" if storage throws rather than
crashing the page; a hidden-tab pause only resumes on return if the user
had explicitly opted in AND the browser still permits it, never forcing
playback. `preload="none"` keeps the file off the critical path until
opt-in. Independent of `src/sse.ts` and the existing
`prefers-reduced-motion` guard on the homepage's steam animation — neither
was touched.

**Found and fixed while wiring this up, not part of the original ask**:
Hono's built-in MIME map has no `.ogg` entry (only the rarer `.oga`), so
`serveStatic` would have sent the file as `application/octet-stream`.
Harmless to a `<audio>` tag (its own `canPlayType` check doesn't consult the
HTTP header) but wrong for anything else fetching the file directly —
`src/server.ts` now corrects the header for that one path after
`serveStatic` runs.

Verified: `spec/nav.test.ts` and `spec/music.test.ts` (11 tests) drive the
real rendered layout and the real, unmodified `public/music.js` through
jsdom — default-off state, a resolved `play()` flipping the button to an
accurate "on", a rejected `play()` never claiming "on", the
disabled-when-unsupported path, and fail-safe behavior when `localStorage`
throws — plus a direct fetch of the served audio file confirming its
"OggS" signature and a >100KB size (not a truncated or HTML-error
download). `60ed5d0` is a same-session self-correction: the first commit's
own `spec/nav.test.ts` asserted against `/community`, a route that didn't
exist until a later commit — caught by re-running `pnpm check` against a
clean checkout of just that one commit (not the cumulative working tree),
the same discipline `1b25e42`'s red-CI entry earlier in this file already
established as the lesson. Full suite 53/53 at that commit in isolation.

### Community story reviews: real per-session reviews, no forum, no spoilers by default
[`9928d0e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/9928d0e).

New `story_reviews` table, added the same additive way every migration in
this file has been since the `7965107` data-loss fix: `CREATE TABLE IF NOT
EXISTS` plus one supporting index, no `ALTER` on any existing table, no
reseed. `UNIQUE(puzzle_id, session_id)` is the entire mechanism behind "one
review per session per story, author can edit, nobody else can" —
`upsertReview()` is a single `INSERT ... ON CONFLICT DO UPDATE` keyed by
that constraint, so a session re-reviewing a story it's already reviewed
updates its own row rather than ever creating a second one, and no route
exists that lets a session touch another session's row. No delete endpoint
at all, by deliberate scope cut — a delete surface raises moderation
questions (can an author's own story's negative review be deleted by
someone else? by the author? by nobody?) this project doesn't need to
answer for a review feature.

`GET /community` lists a public puzzle's reviews (nickname/avatar, title
link, formatted English date via `toLocaleDateString`, optional 1–5 star
rating, plain-text body) with a genuine empty state — never fabricated
placeholder reviews. `POST /community` validates server-side (body length
1–2000, rating 1–5 or none, the puzzle must be `shared = 1` **at write
time**, re-checked independently of whatever the `<select>` showed at page
load) with the same PRG `?notice=`/`?saved=1` redirect pattern
`src/routes/rooms.ts` already uses, plus a 5-second per-session posting
cooldown and a same-origin check. The same-origin check was lifted out of
`rooms.ts`'s heartbeat endpoint into a new `src/same-origin.ts` so both
routes share one implementation instead of two copies that could silently
drift apart — `rooms.ts` now imports it instead of defining its own copy.

A private (unshared) puzzle never appears in the story picker, the review
list, or search — `listReviews()`'s query joins against `puzzles` with
`shared = 1` inline, so a since-privatized puzzle's reviews can't leak even
if the row itself still exists. Posting against a private or nonexistent
puzzle id gets the identical generic "not open for reviews" rejection
either way, the same non-selective-rejection pattern `GET
/rooms/new?puzzleId=` already established, so a guessed id can't be used to
probe whether it's "private" vs. "doesn't exist." A spoiler-flagged review
renders inside a collapsed `<details>/<summary>` fold rather than being
hidden behind client-side JS, so it degrades to "visible but requires an
explicit click" with no script at all. Review bodies are plain text, always
run through the existing `escapeHtml()` — confirmed with a literal
`<script>` payload posted and checked to come back escaped on the rendered
page, not just reasoned about.

Reviews are deliberately **not** a room transcript viewer or a general
forum: nothing in `src/render/community.ts` or `src/routes/community.ts`
touches `src/sse.ts`, references a `room_id`, or reads `qa_entries` — a
dedicated test posts a question in a real active room and confirms it never
reaches the community page, specifically to catch the two features being
accidentally conflated.

**Migration safety, verified three ways, not just asserted**: (1) the new
`CREATE TABLE IF NOT EXISTS` is a no-op against a database that already has
it — confirmed by restarting the local dev server against the same
data directory and finding every room and every review posted in the prior
run still present; (2) built a throwaway fixture carrying the *exact*
pre-this-session schema (no `story_reviews` table at all, real
rooms/sessions/puzzles data already in it) and booted the current,
unmodified `src/db.ts` against it directly — the table gets created, every
pre-existing row survives untouched, and a review can be written and read
back immediately afterward; (3) no existing table's `DDL` changed at all in
this migration, so there's no dangling-foreign-key risk of the kind the
`rooms_old` incident (documented earlier in this file) caused — the new
table only ever references existing tables, nothing references it yet.

Verified: 23 tests (later growing to 24, see below) in
`spec/community.test.ts` covering the empty state, PRG success feedback
with escaped author/date/rating, XSS escaping, same-session edit-in-place
(confirmed as an `UPDATE`, not a second row), cross-session identity
isolation (each session sees only its own "Your review" badge), rejected
empty/too-long/bad-rating submissions with the typed body preserved for
retry, the posting cooldown, cross-origin rejection, private-puzzle
exclusion from every surface (list, search, form options, and POST
rejection), spoiler folding, the `?puzzleId=` filter-and-preselect, the new
`/cases` → `/community` review link, and non-mixing with room transcripts.
Full suite 67/67 across 14 files at this commit, `pnpm typecheck` and `pnpm
build` clean, against an isolated local server (port 8082, its own
throwaway `DATA_DIR`, `ALLOW_MOCK_JUDGE=1`) — the user's own running
preview processes on other ports were never stopped or touched, per this
session's explicit instruction to leave them alone.

### Two follow-up UI fixes from direct user feedback on the rendered layout

After the above landed, the user gave two specific, concrete corrections
against the actual rendered output — not new features, fixes to how the
nav and FAQ actually looked once built. Each shipped as its own commit,
per this session's "independent logical change → independent commit" rule.

**Nav layout: grouped left, not centered**
([`063d479`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/063d479)).
The first nav commit's `.site-header` used `justify-content: space-between`
across all three flex children (brand, nav, `.site-controls`) — which
spreads three items evenly across the header's width, landing
Home/Case&nbsp;Library/Community visually in the middle rather than reading
as attached to the brand on the left. This was a real layout bug, not a
matter of taste: `space-between` on *N* children always distributes them
evenly regardless of how wide any one of them is, so no amount of content
tweaking elsewhere would have fixed it without changing the positioning
strategy itself.

Fixed by wrapping the brand and nav in a new `.site-header-left` flex group
(so they move, and wrap on narrow screens, as a single unit) and giving
`.site-controls` its own `margin-left: auto` instead of leaning on the
parent's `justify-content`. `.site-header` itself no longer sets
`justify-content: space-between` at all — with one child's own
`margin-left: auto` doing the "push everything after me to the far edge"
job, there's nothing left for a three-way `space-between` to do, and
removing it is what guarantees the nav can never drift back toward center
regardless of how wide the controls group gets (a longer nickname, a wider
music-button label). On a narrow viewport the left group wraps as its own
unit before it affects `.site-controls`'s position, so the three nav links
stay anchored under the brand instead of drifting toward center or
colliding with the music button's touch target.

Verified: 2 new tests (`spec/nav-layout.test.ts`) check both the DOM
structure (`.site-header-left` wraps exactly the brand and nav; `
.site-controls` is a later sibling, not nested inside the same group) and
the compiled stylesheet itself (`.site-controls` carries `margin-left:
auto`; `.site-header`'s own rule no longer contains `justify-content:
space-between`) — testing the actual mechanism of the fix, not just that
some visual outcome looks plausible from HTML alone. Full suite 69/69 at
this commit. **Not independently verified in a real browser at 360px in
this session** (no GUI browser available, consistent with every prior
"theme pass" entry in this file) — a real visual check at that width is
still the user's/Codex's to do against the next live preview.

**FAQ: independently-collapsible `<details>`, not one big reveal**
([`0a42121`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/0a42121)).
User feedback, explicitly modeled on tanghenre.com's FAQ pattern: the old
`<dl>` showed every question and its full answer at once, with no way to
scan just the questions. Reworked each item into its own `<details>`
element — not a single button gating the whole section, which the user
explicitly ruled out — so every question collapses independently, defaults
to closed, and any number can be open simultaneously. All five existing
Q&A pairs are unchanged verbatim; only the wrapping markup
(`dl`/`dt`/`dd` → `details`/`summary`/`p`) and its CSS changed.

`<details>`/`<summary>` was picked specifically because it's native browser
behavior: a `<summary>` is in the tab order with no `tabindex` needed, and
Enter/Space toggles it with zero JavaScript — consistent with this app's
standing "works fully with JS off" design (documented in `README.md`'s
Stack section) rather than introducing a new JS-dependent accordion widget.
The plus/minus indicator is a CSS-only `::before` glyph keyed off the
browser's own `[open]` attribute (`.faq-item[open] summary::before`), not
JS-tracked state — a single "+" rotated 45° into a "×" when open, using a
`transform` rather than swapping the glyph's text content specifically so
the homepage's existing `prefers-reduced-motion` media query (already
guarding the steam animation) has something real to gate: a transform can
be meaningfully transitioned or not; a content swap can't be "reduced" in
any sense that matters. The default `::-webkit-details-marker` triangle is
hidden so the custom glyph doesn't double up with a native one in
WebKit-based browsers.

Verified: 3 new tests (`spec/faq.test.ts`) — every item renders collapsed
(no `open` attribute) with all five original question/answer pairs intact
verbatim; a `jsdom`-driven click on each `<summary>` toggles that specific
item's native `.open` property independently, confirming opening one never
force-closes another and multiple can be open at once — this drives
`<details>`'s actual native toggle behavior through jsdom, not a
reimplementation of accordion logic in test code; and the compiled
stylesheet carries a `:focus-visible` outline on `.faq-item summary`. Full
suite 72/72 across 16 files at this commit, `pnpm typecheck` and `pnpm
build` clean. **Not independently verified in a real browser** — the
click/keyboard semantics of `<details>` are standardized and implemented
identically across evergreen browsers, but an actual visual/interaction
check (does it look right, does Enter/Space actually work with a keyboard
in a real window) is still the user's/Codex's to do against the next live
preview, same caveat as every prior visual-only pass in this file.

### What's still open from this session

- **No real-browser visual/interaction verification** of any of the five
  commits above — this environment has no GUI browser, the same standing
  limitation recorded in the theme-pass entries earlier in this file. The
  user's own preview (Codex, on port 8083 against its own local database)
  is the mechanism for that check; it was deliberately left running and
  untouched throughout this session, and nothing here claims a visual pass
  that didn't happen.
- **No encoded fallback audio format.** `ffmpeg`/`sox`/`opusenc` are not
  installed in this sandboxed environment, so a browser that can't decode
  the shipped CC0 OGG file gets a disabled, explained toggle rather than a
  second-format file. The CC0 source file was only ever available as OGG
  from its official OpenGameArt download link; re-encoding it would need a
  tool this session couldn't install or verify for correctness, so
  graceful degradation (disabled + explained, never a silently broken
  button) was the honest choice over shipping an unverified converted file.
- Nothing in this session was pushed to `origin/main`, deployed, or
  touched in production — every commit above sits on the local `main`
  branch only, per this session's explicit, narrower-than-usual
  authorization. The next session (or the user directly) still needs to
  decide when to push and redeploy.

*(Update from the next session: all six commits above were pushed to
`origin/main` — HEAD at [`1420f4d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/1420f4d)
— and deployed to the live Fly app. Production was backed up first with
`node:sqlite`'s real `backup()` API to
`/data/app-before-community-1793160826209.db`, verified with
`PRAGMA integrity_check` returning `ok` and matching row counts (2 rooms,
9 qa_entries) before the deploy touched anything. Post-deploy, `/community`,
`/music.js`, and `/audio/creepy-ambient.ogg` all returned 200 live, and the
music toggle's on/off click was confirmed working. No production data was
reset. See the next section for a stale-asset-cache bug found right after
this deploy and its fix.)*

## Cache-busting first-party static assets, found right after the nav/community deploy

Right after the deploy above, a real browser session that had the app open
from *before* the nav rework still showed the old centered-nav layout and
the old gold `<button>` styling on the music toggle — looking exactly like
the CSS rules for `.site-header-left`/`.music-toggle` had never shipped.
Root-caused before touching any code: reading `document.styleSheets` in
that same real browser showed its loaded `/styles.css` had no
`.site-header-left` or `.music-toggle` rules at all, but a plain HTTP
request for `/styles.css` against the same live URL (bypassing the
browser's cache) returned the current 16945-byte file with both rules
present. That rules out a missing-rule regression in the stylesheet itself
— the bug was a browser serving its own stale cached copy of the
*previous* deploy's `/styles.css` because the URL never changed between
deploys, not anything wrong with the new CSS.

Fixed by adding `src/render/asset.ts`: a single `RELEASE` constant
(`20261028-nav-community-1`) appended as a `?v=` query string to every
first-party `<link>`/`<script>` URL rendered by the layout and page
templates — `/styles.css`, `/music.js`, `/lobby.js`, `/client.js`,
`/create-case.js`. A new deploy that bumps `RELEASE` serves its assets from
a URL a browser has never cached, without pulling in a bundler, a service
worker, or any external dependency — this repo has no build step for
`public/` assets to hash, so a hand-bumped release string is the simplest
thing that actually fixes the bug within the existing stack. Commit:
[`a6ece0c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/a6ece0c).

`spec/music.test.ts`'s exact-string assertion on
`<script src="/music.js">` no longer matches once the URL carries a query
string, so it was updated to a regex (`/<script src="\/music\.js\?v=[^"]+">/`)
that still requires the same script tag to exist — not weakened, just
adjusted for the now-versioned URL, per this repo's own rule against
loosening assertions to make a change land.

**Verified**: `pnpm typecheck` and `pnpm build` clean. Full suite run
(72/72 across 16 files) against a freshly started, fully isolated server
on port 8082 — its own `DATA_DIR` and `ALLOW_MOCK_JUDGE=1`, matching
`APP_URL` — left running throughout this check and torn down afterward;
the existing preview on port 8083 was identified by its actual listening
process (`ss -tlnp`) and never touched. Then deployed with
`mise exec -- flyctl deploy --remote-only --ha=false -a
comp4020-final-yanzzzzzzzz` (no new backup needed — this change touches
only static asset URLs, not the database or its schema). Verified against
the live deploy directly: the homepage's rendered `<link>`/`<script>` tags
all carry `?v=20261028-nav-community-1`, every one of those versioned URLs
returns 200, `/community` and `/audio/creepy-ambient.ogg` still return 200,
and the production `/styles.css` served at that versioned URL was fetched
and confirmed to actually contain both `.site-header-left` and
`.music-toggle` — the fix closes the loop a browser's cache was breaking,
rather than just asserting the deploy succeeded.
