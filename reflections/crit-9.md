# Crit 9 — All at once

**What was the breakthrough that moved the work forward?**

Checking real-time against localhost would have been checking the wrong
thing. The actual requirement is that it holds on the deployed shape, so I
had Claude verify against the live Fly URL directly — and caught it about to
go hunting for a way to authenticate `flyctl` locally first. Turned out
unnecessary: CI already redeploys on every push using a token the course
provisioned, so the live site was already current. Correcting that
detour before it burned time, and insisting on a number (17ms transcript
propagation, 16–29ms for presence) instead of "it works," is what actually
grounds the real-time claim in this week's PROCESS.md.

The concurrency decision came from the same discipline applied to feedback,
not just code. A review pushed for a full host/ready-up room lifecycle; I
had Claude check it against our own README's stated design (no accounts, no
gatekeeping) before building it, and we scoped it down to a derived
not-started/in-progress read instead. Grounding a decision in a document we
already committed to, rather than in whichever feedback arrived most
recently, kept six separate feature asks from turning into one unreviewable
diff.

**What did this work change about who I want to be as a software developer?**

I want to be someone who treats an AI agent's willingness to build
everything asked of it as something to steer, not something to be grateful
for. The useful move this week wasn't approving more scope — it was making
Claude justify each addition against a document already in the repo, and
cutting the rest out loud instead of letting it quietly balloon.
