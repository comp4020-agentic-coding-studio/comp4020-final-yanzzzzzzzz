# Agentic development needs verifiable handoffs, not longer unattended runs

## Position

Reliable agentic development should be organised around verifiable handoffs:
small changes accompanied by executable checks, inspectable state and an
explicit account of what remains untested. Longer autonomous runs can be
useful, but duration is a poor proxy for delivered value. This position is
stronger than simply recommending more tests. It requires distinguishing
three different claims: a patch passes an evaluation, a developer becomes
more productive, and a deployed system works for its users. The literature
does not justify treating those claims as interchangeable.

## What different evidence establishes

Jimenez et al. (2024) introduce SWE-bench using 2,294 issues from twelve
Python repositories. Its important contribution is moving evaluation beyond
isolated function generation towards changes within existing software.
Repository-level tasks require coordinated edits and contextual reasoning.
However, a benchmark establishes performance under its task construction and
acceptance criteria. It cannot, by itself, show that a developer spends less
time reviewing a patch or that a deployed interface is usable. The inference
from benchmark success to dependable development therefore needs additional
evidence. This is a limitation of the inference, not a reason to discard
benchmarks as regression instruments.

Becker et al. (2025) supply a complementary perspective through a randomised
study of sixteen experienced open-source developers completing 246 tasks.
Allowing early-2025 AI tools increased completion time by 19%, despite
participants believing the tools helped. That finding challenges perceived
speed as an evaluation method. It does not establish that AI generally slows
all developers: the participants, familiar repositories and contemporary
tools constrain its scope. METR's 2026 follow-up explicitly reports selection
and time-measurement problems as developers increasingly adopted AI (Becker
et al., 2026). The later uncertainty prevents using the original slowdown as
a timeless verdict. Together, the studies argue for measuring the actual
workflow, including supervision and rework, rather than extrapolating from
confidence or adoption.

Anthropic (2025) addresses a different problem: continuity across long agent
sessions. Its engineering account recommends incremental changes, progress
artifacts, git history and end-to-end checking, observing that agents may
declare completion prematurely. These mechanisms support verifiable handoffs
because a later worker can inspect what happened instead of trusting a
summary. Yet this is a vendor's account of its own harness experiments,
not an independent controlled comparison. It offers plausible mechanisms
and implementation guidance; it does not quantify a general productivity
gain or establish that its particular harness is optimal.

## A practical standard, with a counter-case

The strongest counterargument is that frequent handoffs create overhead.
Requiring a person to inspect every trivial edit can erase the advantage of
autonomy, while deterministic checks can miss the design problem entirely.
A workable standard should therefore make verification proportional to the
claim and consequence. A bounded text edit may need a diff review; a schema
change needs migration evidence; a shared interface needs observation from
independent sessions. Successful checks should permit continued work rather
than automatically creating another approval gate.

This distinction also changes what counts as progress. A useful handoff
states the tested version, the environment, the observed result and its
limits. If the same agent writes the implementation, weakens the acceptance
criteria and declares success, apparent completeness becomes circular.
Independent specifications, preserved regression tests and deployed checks
help interrupt that circle. Human judgement remains necessary to decide
whether those criteria protect something worth building.

The Turtle Soup project's production-only upload failure illustrates this
boundary: local success did not reproduce HTTPS termination at the hosting
proxy. It is an example of an environment mismatch, not an experiment proving
the superiority of one workflow. Its broader relevance is the need to attach
claims to the conditions actually checked.

A future comparison should measure total time to an accepted deployed change,
review effort and escaped defects under both long autonomous runs and bounded
handoffs. Until such evidence is available, verifiable handoffs provide a
more defensible engineering standard than unattended runtime or persuasive
completion messages. Autonomy should expand when its evidence improves.

## References

- Anthropic. (2025, November 26). [Effective harnesses for long-running agents](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents). Engineering article.
- Becker, J., Rush, N., Barnes, B., & Rein, D. (2025, July 10). [Measuring the impact of early-2025 AI on experienced open-source developer productivity](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/). METR research report.
- Becker, J., Rush, N., Cunningham, T., Rein, D., & Mahamud, K. (2026, February 24). [We are changing our developer productivity experiment design](https://metr.org/blog/2026-02-24-uplift-update/). METR methodological update.
- Jimenez, C. E., Yang, J., Wettig, A., Yao, S., Pei, K., Press, O., & Narasimhan, K. (2024). [SWE-bench: Can language models resolve real-world GitHub issues?](https://arxiv.org/abs/2310.06770). ICLR 2024.