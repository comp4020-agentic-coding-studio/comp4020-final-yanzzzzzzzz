# Turtle Soup Puzzle Room

[Play the deployed game](https://comp4020-final-yanzzzzzzzz.fly.dev/).
Open a case, share its room code, and invite a friend in another browser.
The host starts the investigation; everyone reads the same premise and
transcript. Ask a question to test a detail, or submit a final explanation
when the pieces fit. No account is required.

## What makes this game good

Turtle Soup is a lateral-thinking game for a small group of friends, built
around one shared mystery rather than separate conversations with a chatbot.
A good session lets people build on one another's questions without losing
track of who asked what. Success means discovering the case's causal logic
together, not guessing the judge's preferred wording.

[Nielsen's usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)
provide a further lens: visible pending states and readable failures matter
because an unexplained pause interrupts the group's reasoning. These are
design references, not evidence that the interface has been independently
usability-certified.

## Fair questions, shared consequences

The Case Library contains eight built-in stories and publicly shared
player-authored cases. Players can also write a case with an optional cover.
A profile supplies a nickname and uploaded avatar; otherwise a Mystery
Detective name and default portrait identify the player. Identity belongs to
the browser session, so clearing cookies loses access to that identity.

Your Partner, Watson judges against the current room's stored solution.
Questions and final guesses are separate actions: confirming one fact must
not accidentally end the case. The intended standard is generous about
paraphrases and strict about the explanation's essential causes and twist.
The server accepts constrained decisions and displays fixed replies rather
than unrestricted model prose. Only a correct final guess resolves the room.
This limits disclosure; it does not prove that every AI judgement is right.
The host can also end an unsolved investigation for everyone from a
confirmation page, which keeps the transcript but never reveals the solution.
A room page splits into a compact header, a left case-file panel (cover,
premise, members, end-investigation link), and the conversation on the
right, collapsing the case file into a closed-by-default disclosure on
narrow screens; a reconnecting tab also learns of a status change it missed
while offline instead of only ones broadcast while it was connected.

Room and lobby changes use Server-Sent Events. SQLite and uploaded images
live on Fly's persistent volume, so a redeploy does not intentionally erase
the investigation. The homepage's reasoning total measures eligible active
participation, not intelligence or verified concentration.

## What is checked, and what still needs judgement

The automated suite protects session ownership, live updates, reconnect
behaviour, persistence migrations, upload validation, judge failure handling,
and the separation between questions and final guesses. The latest local
verification passed 194 tests. Checks also require this README to be
published at `/readme/`.

Human judgement is still needed for atmosphere, comfortable reading and
semantic fairness across different explanations. Recent feedback led to
removing page-flip animation, improving contrast and eliminating duplicate
Watson replies. Full two-viewport acceptance and broader real-model testing
remain necessary; a green suite does not establish either.

## Boundaries and records

This is a small hosted game, not a moderated social network. There is no
cross-device account recovery or automatic host failover. Community reviews
hide marked spoilers by default but cannot detect every unmarked spoiler.
Music starts only by choice. Some stories contain horror or graphic content.

See [PROCESS.md](PROCESS.md) for decisions and evidence,
[CLAUDE.md](CLAUDE.md) for working rules, and
[ASSET_LICENSES.md](ASSET_LICENSES.md) for media provenance.