# Working rules for this repo

## Git discipline
- Every change gets committed, and every commit gets pushed to `origin/main`
  immediately — don't batch work into one giant commit at the end. The repo
  is currently private, so pushes don't trigger CI/deploy yet; the habit has
  to already be in place before `/ship` flips it public.
- Commit messages explain *why*, not just what changed. `PROCESS.md` links
  evidence by commit hash, so a message that only restates the diff is
  worthless later — say what problem it solved or what was chosen and why.
- Never force-push, `rebase -i`, or rewrite history on `main`.
- Run `pnpm check` before pushing when the change touches app code. If it's
  red and still needs to land (e.g. a deliberate WIP checkpoint), say so in
  the commit message — don't leave it unexplained.

## Quality bar for the app
- Keyboard-only use must work end to end: visible focus, a sane tab order,
  no control that's only reachable with a mouse.
- The layout must survive a resize mid-interaction — no broken state if the
  viewport changes while a modal/drag/form is in progress.
- Usable on a slow or flaky connection: something visible happens quickly,
  slow requests don't look like silent failure, nothing hangs forever with
  no feedback.
- Respect the fixed deploy shape — one shared-cpu-1x machine, 256MB RAM, one
  volume at `/data`, no second service. Don't design around resources that
  aren't there.
- `spec/invariants.test.ts` (`/` → 200, `/readme/` renders `README.md`'s
  headings server-side, in order) is never weakened or deleted.

## Process discipline
- When something breaks, find the root cause before retrying. "Ran it again
  and it worked" is not a resolution worth recording — if a retry really is
  the fix, say why the first run failed.
- When there's a real choice between approaches, write down why one was
  picked — in the commit message, or in `PROCESS.md` if it's a decision
  worth a reader's attention. That reasoning is half the grade on this
  project; a clean diff with no rationale behind it isn't enough.
- One idea, built well, beats a list of half-built features. A feature that
  doesn't serve the core idea gets cut, not added "while we're at it."

## Docs that stay current, not retroactive
- `PROCESS.md` — link commit hashes as the work happens, not reconstructed
  from `git log` at the end.
- `reflections/crit-{8,9,10}.md` — exact filenames, 150–300 words, in place
  by each crit's cutoff, answering the two standing prompts.
- `README.md` — describes the app as it actually is; it's served verbatim
  at `/readme/`, so it's read there too, not just on GitHub.
