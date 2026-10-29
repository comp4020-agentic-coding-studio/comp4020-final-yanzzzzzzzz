# Process overview

## Scope and the standard of good

This project answers the brief with a shared lateral-thinking mystery room.
The earlier process record describes rejecting generic multiplayer ideas and
a more elaborate script-murder game: private character scripts and timed
phases would have enlarged the content problem before the shared interaction
worked. The chosen unit is one room, one premise, one solution and a shared
transcript. The initial harness established commit discipline and protected
course invariants before implementation
([dca01b8](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/dca01b8),
[c4b317b](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/c4b317b)).

The definition of good became more specific through feedback: players should
reason together, know whose contribution they are reading, and receive an
honest indication of pending work or failure. The current README articulates
that position. Its references were checked during this final documentation
revision; they should not be read as proof of literature consulted before
all earlier implementation decisions.

## Stack and its costs

The initial implementation chose Node 24, TypeScript, Hono, SQLite and
server-rendered HTML
([5f5e97b](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/5f5e97b)).
Node's SQLite binding avoided a separate database service and binding build
step within one 256 MB Fly machine. HTML forms provide a basic request/response
path; vanilla JavaScript adds live updates. This reduces frontend machinery,
but requires maintaining both server-rendered and client-rendered message
paths. The duplicate-answer defect later demonstrated that cost.

SSE was chosen over WebSockets because updates mostly flow from server to
viewers while actions remain HTTP requests. EventSource provides reconnection,
but persistence and replay still require application code; automatic transport
reconnection alone does not restore missed state. SQLite on `/data` fits the
single-machine constraint. It also makes schema migrations and backups
load-bearing rather than optional operational details.

## Making presence consequential

The first lobby correction addressed a design failure: people clicking the
same homepage action could each create an isolated room. Listing joinable
rooms and broadcasting their creation reused the room pub/sub mechanism
([1b25e42](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/1b25e42),
[05e3929](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/05e3929)).
That pair also records a mistake: splitting dependent frontend/backend changes
left an intermediate commit that did not typecheck. Keeping the history is
more honest than presenting every commit as a verified release.

Later reports that rooms required refreshing exposed three concrete gaps:
a lobby subscription race, missing status broadcasts and swallowed submission
errors. Their correction was behavioural, not cosmetic
([20e5aba](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/20e5aba)).
Session-owned messages, presence and host-controlled starting make other
players visible without requiring accounts. This simplicity costs cross-device
identity recovery and automatic host succession, which remain outside scope.

## Persistence changed the verification method

Translating seed files did not translate rows already stored on Fly. Later
reconciliation needed stable puzzle identities and had to distinguish reference
content from player data. A migration verification pass caught actual data
loss, followed by a correction
([7965107](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/7965107)).
The final English reconciliation uses stable slugs
([115d992](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/115d992)).
The archived record also describes production foreign-key failures where a
matching error message was insufficient evidence of a matching database schema.
These incidents support testing upgrades against populated databases, inspecting
the real schema when diagnosing production, and backing up before deployment.

## A judge that must not quietly pretend

The original Groq implementation could silently use keyword matching without
a configured key. Production therefore appeared AI-enabled without establishing
that a real call had occurred. The correction made mock judging explicitly
opt-in
([5b095f4](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/5b095f4)).
Groq signup problems later motivated Gemini's native REST integration
([78ac977](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/78ac977)).
Deploy success still did not prove authentication: a real request exposed an
invalid key before valid-key testing was recorded
([87a2def](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/87a2def)).

The judge receives the room's server-selected solution, uses separate question
and final-guess decisions, and exposes fixed reply strings. Prompt changes
accept paraphrases without dropping essential causal requirements
([b7e353a](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/b7e353a)).
These constraints reduce disclosure and inconsistent presentation; they cannot
establish semantic correctness for every possible question. Deterministic
mock tests verify plumbing, not the real model's understanding.

## Feedback, rejection and narrower tasks

The mystery archive styling, cover images and open-dossier creation page aimed
to communicate the game's mood. The requested book-flip effect was rejected
after use and removed rather than defended as technical effort
([a988225](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/a988225)).
Player feedback also changed the transcript into a readable conversation with
a multiline composer
([315624e](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/315624e)).

Claude Code performed implementation while the coordinating assistant supplied
scoped tasks, reviewed diffs, ran checks and deployed. This arrangement also
failed: broad tasks repeatedly investigated already-known paths, background
work timed out, and test-server permission requests blocked progress. Narrow,
foreground edits and coordinator-run verification restored progress. The
latest release removed repeated Watson verdicts and the redundant avatar picker,
fixed profile contrast, simplified About without action buttons, and filtered
exact obsolete configuration notices
([feb5408](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/feb5408)).


The harness records some corrections as lasting checks rather than instructions
to retry: migration tests protect existing rows, live-sync tests exercise a
second viewer, and the latest notice tests accept only two known obsolete
messages. Upload checks cover corrupt pixels, draft preservation and rejected
cross-origin requests. Conversely, the prolonged investigation loop did not
receive an automated progress detector in this revision. Narrowing prompts
helped operationally, but claiming that failure was permanently prevented
would exceed the evidence. This distinction separates a successful recovery
from an improvement already enforced by the harness.
## Verification and remaining limits

Local validation on 29 October passed typechecking, 194 tests across 24 files,
and the production build. `check:evidence` resolved 50 cited historical commits
before this condensation; it verifies reference existence, not narrative quality.
A prior production avatar failure was traced to Fly's internal HTTP scheme
versus the browser's HTTPS Origin and fixed without accepting arbitrary origins
([3f2a277](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/3f2a277)).
The latest release backed up SQLite successfully, deployed, and passed HTTPS
avatar upload/removal, draft retention, cross-origin rejection and eight-cover
availability checks. No real-model calls were made in that release check.

Full current-version acceptance at both marking viewports, slow-network tests
and broader semantic judging remain outstanding. This overview is an
AI-assisted condensation of the preserved
[historical process log](docs/archive/PROCESS-before-final-edit.md), not a
claim of independently conducted user research. The COMP8020 research note
is separate; its literature argument is not interchangeable with this record.

## Final document revision

At the author's request, the coordinating assistant directly condensed this
overview and README rather than routing those edits through Claude Code.
The unabridged process log remains archived. A separate AI-assisted COMP8020
research-note draft compares benchmark evaluation, developer productivity and
agent harness guidance; its claims require author review. Evidence checks
and both README publication invariants passed after this revision. This
editing step does not establish original authorship or replace that review.

### Room lifecycle and layout revision

[74478240e1c9801481db84f50b677dc1b98bc5bb](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/74478240e1c9801481db84f50b677dc1b98bc5bb) adds host-confirmed unsolved closure using an additive closed_at field rather than rebuilding the status constraint. A reconnect snapshot restores missed terminal changes. The room now gives chat priority beside a compact, paragraph-preserving case file. Unknown detail decisions display Irrelevant; historical replies remain recognizable. Validation passed 205 tests, typecheck and build. Browser checks confirmed mobile folding, no horizontal overflow and retained history after host closure. Initial failures exposed cached database handles and SSE event-order assumptions; layout review also corrected percentage-grid overflow and native details behaviour. These lessons now enter CLAUDE.md.
