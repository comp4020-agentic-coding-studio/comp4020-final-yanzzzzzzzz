# Submission readiness check — 30 October 2026

Audited source: [60161b8](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/60161b8).
[GitHub Actions run](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/actions/runs/40878785319): check and deploy both succeeded, including evidence and committed-secret scanning.

| Check | Result and scope |
| --- | --- |
| Repository | Public, main pushed, no pending application-code changes at audit time. |
| Local validation | 206 tests across 26 files, typecheck and production build passed. |
| Evidence | Fresh no-local single-branch clone passed; old retained objects cannot satisfy citations. |
| Documents | README 566 words; PROCESS 1092 words; research note 752 words including references. Three named crit reflections present. |
| Desktop/mobile pages | Home, cases, creation, community, profile, About, README and a closed room visited at 1920x1080 and 390x844. No missing images detected. Seven pages had no horizontal overflow; the homepage full-bleed background extends roughly 8px past document width but is already clipped by body styling. |
| Interaction | Keyboard activation of create/start/end confirmed. Draft textarea content survived desktop/mobile resizing; mobile case details collapsed. |
| Host closure | Earlier live two-session test MLBSY rejected a nonhost, delivered the closure event, kept history, left the room unsolved and removed its lobby card. |
| Persistence | Existing rooms remained available through deployments, including closed MLBSY and earlier solved F6463. This is deployment/restart evidence, not a fresh next-day observation. |
| Real Gemini | One live request in 62923 (Is the man short?) returned the fixed 15-second timeout notice instead of a decision. Real semantic acceptance therefore did not pass this time. No automatic retry or mock substitution was used. |
| Test-room cleanup | Host ended 62923 via confirmation; its history and timeout notice remain, and further input is unavailable. |

## Problems found and corrected

The first CI run failed because PROCESS cited earlier commit identifiers changed by the authorized history rewrite. Local old Git objects had hidden the problem. [845a1e8](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/845a1e8) mapped references to current matching commits, retained narrative evidence and verified a fresh clone.

A later CI run exposed second-resolution room timestamp ties: newly created rooms could miss the bounded lobby list. [60161b8](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yanzzzzzzzz/commit/60161b8) added a descending rowid tie-break, a deterministic 25-room fixture and a harness rule. Existing cover assertions and course invariants were not weakened.

## Remaining author decisions and acceptance limits

- Investigate real Gemini latency/availability and obtain a successful real question/guess check before treating the core experience as stable. One timeout is an observation, not proof of a permanent outage or its cause.
- Read the research note and verify that its position and sources reflect the submitting author's understanding; automated checks cannot certify authorship or judgement.
- Artificial network throttling, a full accessibility audit and an independently observed next-day return were not performed in this audit.
- Public repository and successful CI are confirmed. The course's final submission acknowledgement/cutoff cannot be inferred from them; confirm the course-specific hand-in procedure separately.
