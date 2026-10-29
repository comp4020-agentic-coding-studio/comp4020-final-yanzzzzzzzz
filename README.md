# Turtle Soup Puzzle Room

[Play the deployed game](https://comp4020-final-yanzzzzzzzz.fly.dev/).
Open a case, share its room code, and invite a friend in another browser.
The host starts the investigation; everyone reads the same premise and
transcript. Ask a question to test a detail, or submit a final explanation
when the pieces fit. No account is required.

## What makes this game good

Turtle Soup is a lateral-thinking game for a small group of friends, built
around one shared mystery rather than separate chatbot conversations. A good
session lets people build on one another's questions without losing track of
who asked what. Success means discovering the case's causal logic together,
not guessing the judge's preferred wording.

[Nielsen's usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)
are a further lens: visible pending states and readable failures matter
because an unexplained pause interrupts the group's reasoning.

## Fair questions, shared consequences

The Case Library contains eight built-in stories and publicly shared
player-authored cases. Players can write a case with an optional cover. A
profile supplies a nickname and uploaded avatar; otherwise a Mystery
Detective name and default portrait identify the player. Identity belongs to
the browser session — clearing cookies loses it.

Your Partner, Watson judges against the current room's stored solution.
Questions and final guesses are separate actions: confirming one fact must
not accidentally end the case. The intended standard is generous about
paraphrases and strict about the explanation's essential causes and twist.
The server accepts constrained decisions and shows fixed replies rather than
unrestricted model prose. Only a correct final guess resolves the room. The
host can also end an unsolved investigation for everyone from a confirmation
page, keeping the transcript but never revealing the solution. A room page
splits into a compact header, a left case-file panel (cover, premise,
members, end-investigation link), and the conversation on the right,
collapsing the case file into a closed-by-default disclosure on narrow
screens; a reconnecting tab also learns of a status change it missed while
offline.

Room and lobby changes use Server-Sent Events. SQLite and uploaded images
live on Fly's persistent volume, so a redeploy does not intentionally erase
the investigation. The homepage's reasoning total measures eligible active
participation, not intelligence or verified concentration.

The profile page also lists a session's own investigation history and own
uploaded stories, scoped to that browser's cookie, bounded to twenty rows per
page. Status is Waiting, In progress, Solved together, or Ended unsolved —
never a personal "you solved it" claim, since joining a room someone else
later solves isn't solving it yourself. Per-room credited time only exists
from this feature onward; older rows show "Not recorded". The Case Library
gained a "Yours" filter and an "Uploaded by you" badge, computed per viewer
so nobody else's private case is implicated by it.

## What is checked, and what still needs judgement

The automated suite protects session ownership, live updates, reconnect
behaviour, persistence migrations, upload validation, judge failure handling,
and question/guess separation. Checks also require this README published at
`/readme/`.

Human judgement is still needed for atmosphere, comfortable reading, and
semantic fairness across explanations. Full two-viewport acceptance and
broader real-model testing remain necessary; a green suite does not
establish either.

## Boundaries and records

This is a small hosted game, not a moderated social network. There is no
cross-device account recovery or automatic host failover. Community reviews
hide marked spoilers by default but can't detect every unmarked one. Music
starts only by choice; some stories contain horror or graphic content.

See [PROCESS.md](PROCESS.md) for decisions and evidence,
[CLAUDE.md](CLAUDE.md) for working rules, and
[ASSET_LICENSES.md](ASSET_LICENSES.md) for media provenance.