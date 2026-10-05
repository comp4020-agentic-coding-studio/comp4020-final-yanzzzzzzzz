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

## What's still open

Deploying with a real `GROQ_API_KEY` as a Fly secret and a manual
keyboard-only / throttled-network pass in a real browser (this environment
has neither a GUI browser nor a Docker daemon available) — noted here rather
than silently assumed done.
