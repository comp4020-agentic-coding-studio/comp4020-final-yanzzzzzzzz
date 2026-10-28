# Third-party asset licenses

## Background music: `public/audio/creepy-ambient.ogg`

- **Title**: Creepy Ambient Loop
- **Author**: epb9000
- **Source page**: <https://opengameart.org/content/creepy-ambient-loop>
- **Direct file**: <https://opengameart.org/sites/default/files/creepyloop-v2_0.ogg>
  (downloaded and self-hosted as `public/audio/creepy-ambient.ogg`; not
  hotlinked)
- **License**: CC0 1.0 Universal (public domain dedication) —
  <https://creativecommons.org/publicdomain/zero/1.0/>
- **Obtained**: 2026-10-28

CC0 requires no attribution, but it's credited here and linked from the site
footer / `/about#music-credits` anyway, as good practice. Besides this track,
every other asset (the bowl/steam SVG icons, the site's CSS) is original,
hand-written content.

## Mystery-theme photography: `public/images/mystery/*.webp`

- **Source**: generated with Codex's built-in `image_gen` tool (an AI image
  generator) on 2026-10-28, from the prompts recorded in full in this
  repo's own history (see the commit that added this section for the exact
  text used for `hero-mystery.png`, `case-soup.png`, `case-phone.png`, and
  `case-elevator.png`).
- **Originality**: these are original AI-generated images created for this
  project, not photographs of a real place, not sourced from any stock
  library or reference website, and not claimed under any CC0/Creative
  Commons license — no such license applies to AI-generated output, and none
  is asserted here. They're used under the same authorization as the rest of
  this repo's first-party content.
- **What ships**: the full-resolution source PNGs are never committed (they're
  several MB each, generated outside this repo, and this app runs on a
  shared-cpu-1x/256MB Fly machine) — only the compressed `.webp` derivatives
  `scripts/process-images.mjs` produces from them are tracked, at the sizes
  the site actually requests (`hero-mystery-{640,1200,1600}.webp` for the
  homepage hero's `srcset`, `case-archive.webp` as the shared case-library
  cover, and `case-{soup,phone,elevator}.webp` as the three stable per-puzzle
  covers keyed by slug in `src/render/cases.ts`).
- **Exact prompts used** (tool: Codex's built-in `image_gen`, 2026-10-28):
  - `hero-mystery.png`: "original atmospheric hero artwork for a premium
    multiplayer mystery puzzle website, wide cinematic landscape 16:9. Scene:
    a solitary late-night detective study, deep ink navy shadows, warm muted
    brass desk lamp illuminating a steaming ceramic bowl of soup, closed case
    folders with no writing, a magnifying glass on rich dark wood, rain
    streaks on a window and distant blurred amber city lights. Steam curls
    subtly upward, moody but inviting cerebral mystery, sophisticated
    cinematic editorial photograph with painterly grain, realistic materials,
    exquisite soft lighting. Composition: bowl, lamp and investigative
    objects concentrated in right half, left half quiet dark shadow with room
    for real HTML headline overlay. Beautiful restrained amber/navy palette,
    rich tonal depth, crisp focal objects, no horror gore, no guns, no
    humans, no skulls. No text, no lettering, no logos, no watermark, no UI."
  - `case-soup.png`: the hero's shared cover template ("original mystery
    story cover... sophisticated cinematic editorial photography... deep
    navy/charcoal, muted brass and amber highlights... NO lettering, NO
    logos, NO watermarks, NO UI") plus the scene: "A closed late-night
    seaside restaurant, a single ivory bowl of steaming soup on dark wood
    table by rain-streaked window, distant stormy ocean only blurred
    outside, a brass spoon and folded napkin. No people, no guns, no gore,
    no clues to the hidden explanation."
  - `case-phone.png`: same template, scene: "A black vintage rotary
    telephone on a small walnut bedside table in an unoccupied dark room at
    midnight, handset resting on cradle, soft amber light from partly open
    doorway, rain on distant window. No people, no text, no clues to the
    hidden explanation."
  - `case-elevator.png`: same template, scene: "A beautifully aged art deco
    apartment elevator with brass doors slightly open into darkness, warm
    small ceiling lamp and a dim stairwell at the edge, deep ink-blue
    shadows. No floor numerals, no people, no umbrellas, no clues to the
    hidden explanation."
- **Mapping to puzzles**: `case-soup.webp` → `turtle-soup-bowl` ("A Bowl of
  Turtle Soup"), `case-phone.webp` → `silent-phone-call` ("The Silent Phone
  Call"), `case-elevator.webp` → `elevator-routine` ("The Elevator Routine") —
  matched by each puzzle's stable `slug` (`src/data/puzzles.ts`), the same
  identity `reconcileSeedPuzzles()` already uses, not by title text that could
  drift. Every other case (the remaining five built-ins, and any
  player-authored shared puzzle) uses the shared `case-archive.webp` cover —
  real art, not a broken image or an emoji placeholder, just not a
  puzzle-specific commission.
