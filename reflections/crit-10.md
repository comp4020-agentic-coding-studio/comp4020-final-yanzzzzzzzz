# Crit 10 — Reopening a decision, then nearly trusting a fix too early

**What was the breakthrough that moved the work forward?**

The real breakthrough wasn't a feature — it was catching my own verification
as insufficient. The live app turned out to be fully down: a crash loop from
a `rooms_old` table left over by an earlier migration, still foreign-keying
into `puzzles`. I had Claude fix it, reproduce the crash against a throwaway
database, confirm the fix, and ship it. The site stayed down — a *different*
crash. Dropping `rooms_old` had exposed a second, independent bug the first
reproduction never surfaced: SQLite's rename-to-`rooms_old` had silently
rewritten `room_participants`/`qa_entries`'s own foreign keys to point at
`rooms_old` too, years before this week. The fix had matched the crash
*symptom* (same error message, same row counts) but not the actual schema on
disk. Making Claude re-verify against the real `sqlite_master.sql`, not just
behavior that looked similar, caught it before I called the incident closed.

The host-role reopening was the same discipline applied earlier: a reviewer
pushed for a lifecycle I'd already rejected once against the README's
"no gatekeeping" design. Re-reading my own prior reasoning before overturning
it — rather than just building what was asked — kept the decision honest
instead of reactive.

**What did this work change about who I want to be as a software developer?**

I want "it's fixed" to mean I checked the actual state, not that the error
message changed. A fix that matches symptoms but not the underlying shape of
the data is still a guess — and production is where that distinction
actually costs something.
