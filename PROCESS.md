# Process overview

## Scope and the standard of good

This project answers the brief with a shared lateral-thinking mystery room.
The earlier process record describes rejecting generic multiplayer ideas and
a more elaborate script-murder game: private character scripts and timed
phases would have enlarged the content problem before the shared interaction
worked. The chosen unit is one room, one premise, one solution and a shared
transcript. The initial harness established commit discipline and protected
course invariants before implementation
([7a400d1](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/7a400d1),
[8ccce89](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/8ccce89)).

Feedback sharpened the standard: shared reasoning, identifiable contributions
and honest pending/failure states. README references were checked during
final editing, not necessarily before earlier implementation decisions.

## Stack and its costs

The initial implementation chose Node 24, TypeScript, Hono, SQLite and
server-rendered HTML
([331a3f0](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/331a3f0)).
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
([4d24726](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/4d24726),
[9366286](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/9366286)).
That pair also records a mistake: splitting dependent frontend/backend changes
left an intermediate commit that did not typecheck. Keeping the history is
more honest than presenting every commit as a verified release.

Later reports that rooms required refreshing exposed three concrete gaps:
a lobby subscription race, missing status broadcasts and swallowed submission
errors. Their correction was behavioural, not cosmetic
([e458a08](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/e458a08)).
Session-owned messages, presence and host-controlled starting make other
players visible without requiring accounts. This simplicity costs cross-device
identity recovery and automatic host succession, which remain outside scope.

## Persistence changed the verification method

Translating seed files did not translate rows already stored on Fly. Later
reconciliation needed stable puzzle identities and had to distinguish reference
content from player data. A migration verification pass caught actual data
loss, followed by a correction
([45e6e48](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/45e6e48)).
The final English reconciliation uses stable slugs
([114f0ec](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/114f0ec)).
The archived record also describes production foreign-key failures where a
matching error message was insufficient evidence of a matching database schema.
These incidents support testing upgrades against populated databases, inspecting
the real schema when diagnosing production, and backing up before deployment.

## A judge that must not quietly pretend

The original Groq implementation could silently use keyword matching without
a configured key. Production therefore appeared AI-enabled without establishing
that a real call had occurred. The correction made mock judging explicitly
opt-in
([0727b36](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/0727b36)).
Groq signup problems later motivated Gemini's native REST integration
([785764a](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/785764a)).
Deploy success still did not prove authentication: a real request exposed an
invalid key before valid-key testing was recorded
([4cd70fd](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/4cd70fd)).

The judge receives the room's server-selected solution, uses separate question
and final-guess decisions, and exposes fixed reply strings. Prompt changes
accept paraphrases without dropping essential causal requirements
([60af070](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/60af070)).
These constraints reduce disclosure and inconsistent presentation; they cannot
establish semantic correctness for every possible question. Deterministic
mock tests verify plumbing, not the real model's understanding.

## Feedback, rejection and narrower tasks

The mystery archive styling, cover images and open-dossier creation page aimed
to communicate the game's mood. The requested book-flip effect was rejected
after use and removed rather than defended as technical effort
([482d8bc](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/482d8bc)).
Player feedback also changed the transcript into a readable conversation with
a multiline composer
([9fbaed9](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/9fbaed9)).

Claude Code performed implementation while the coordinating assistant supplied
scoped tasks, reviewed diffs, ran checks and deployed. This arrangement also
failed: broad tasks repeatedly investigated already-known paths, background
work timed out, and test-server permission requests blocked progress. Narrow,
foreground edits and coordinator-run verification restored progress. The
latest release removed repeated Watson verdicts and the redundant avatar picker,
fixed profile contrast, simplified About without action buttons, and filtered
exact obsolete configuration notices
([5f76587](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/5f76587)).


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
([765a7df](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/765a7df)).
The latest release backed up SQLite successfully, deployed, and passed HTTPS
avatar upload/removal, draft retention, cross-origin rejection and eight-cover
availability checks. No real-model calls were made in that release check.

Full current-version acceptance at both marking viewports, slow-network tests
and broader semantic judging remain outstanding. This overview is an
AI-assisted condensation of the preserved
[historical process log](docs/archive/PROCESS-before-final-edit.md), not a
claim of independently conducted user research. The COMP8020 research note
is separate; its literature argument is not interchangeable with this record.

## Final revision and release evidence

The coordinating assistant condensed these documents at the author's request;
original narration remains archived and the COMP8020 literature note is separate.

[7447824](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/7447824)
added confirmed, unsolved host closure, reconnect snapshots and the chat-first
case file. Its 205 tests and live two-session closure checks passed; history
was retained and the lobby entry removed.

History rewriting changed earlier commit identifiers. Local retained objects
hid broken citations until CI failed. References were repaired and checked
in a fresh clone. A later CI failure exposed same-second lobby timestamp ties;
[60161b8](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/60161b8)
added deterministic insertion ordering and a 25-room regression fixture.

[c3dc9d6](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/c3dc9d61474c5ad572d96f7588fa26f05bbf6e52)
adds cookie-scoped investigation history, owned public/private stories and
Uploaded by you badges. Personal time receives only existing deduplicated
heartbeat credit; historical NULL stays Not recorded. Authors can replay
private stories, strangers cannot. The column is added after legacy table
repairs. All 219 tests, typecheck and build passed; production was backed up
before deployment. Failed test fixtures had omitted joining or misread the
heartbeat response; corrections preserved the API and strengthened migration
checks. Three rewritten classic cases were uploaded through the real form,
with sources in hidden solutions. One earlier real Gemini call timed out;
real-model reliability remains unconfirmed, despite passing mock checks.


[31fe238](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/31fe238)
fixes homepage recommendations to the original three built-in slugs, excluding
player uploads even when titles match. The regression checks both fixed order
and continued player-library visibility. All 220 tests, typecheck and build passed.
