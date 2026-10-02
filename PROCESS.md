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
back labelled `匿名侦探#2`, not `#1`. Tracing it through, the test's own
`createRoom()` helper visited the room page once already (purely to extract
a session cookie for other tests), which itself registered an anonymous
participant and consumed the `#1` slot before the test's own "first visitor"
request ever ran. The app's participant numbering was correct the whole
time; the test was shifting its own count by one. Fixed by splitting
`createRoom()` (creates the room, nothing else) from a separate `visitRoom()`
helper (visits as a new anonymous session), so no test accidentally
pre-consumes a participant slot it didn't mean to.

## What's still open

Deploying with a real `GROQ_API_KEY` as a Fly secret, a manual keyboard-only
and throttled-network pass in a real browser (this environment has neither a
GUI browser nor a Docker daemon available), and confirming the actual
`docker build`/`docker run` path matches what CI runs — all noted here
rather than silently assumed done.
