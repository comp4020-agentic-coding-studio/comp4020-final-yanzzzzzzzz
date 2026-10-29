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
  cover, and `case-{soup,phone,elevator,desert,gas-station,shoes,straw,dinner}.webp`
  as the eight stable per-puzzle covers keyed by slug in `src/render/covers.ts`).
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
  drift. Any player-authored shared puzzle with no cover of its own uses the
  shared `case-archive.webp` cover — real art, not a broken image or an emoji
  placeholder, just not a puzzle-specific commission.

## Five additional case covers: `case-{desert,gas-station,shoes,straw,dinner}.webp`

- **Source**: generated with Codex's built-in `image_gen` tool on
  2026-10-29, independently (no reference image used for any of the five),
  from the prompts recorded in full in `CASE_COVER_PROMPTS.md` alongside the
  source PNGs at generation time (not committed to this repo — see "What
  ships" above for why). Each image was visually inspected before use:
  landscape 16:10, no text/typography/logo/watermark, no gore or visible
  corpse, and no detail that gives away any puzzle's hidden solution.
- **Originality**: same basis as the first four covers above — original
  AI-generated images created for this project, not photographs of a real
  place, not sourced from stock/reference imagery, and not claimed under
  CC0 or any Creative Commons license (none applies to AI-generated output).
  Used under the same authorization as the rest of this repo's first-party
  content.
- **Shared prompt prefix** (prepended to every one of the five below):
  "Use case: stylized-concept. Asset: original landscape 16:10 cover for an
  English multiplayer lateral-thinking mystery game. Polished cinematic
  realistic still-life, moody noir, deep ink/navy shadows and warm amber
  practical light, subtle film grain, rich tactile detail, readable central
  subject at small card size. A single image, no text, no typography, no
  logo, no watermark, no panels or collage. Evocative mystery rather than
  gore, no visible corpse, no solution spoilers."
- **Per-image scene prompts**:
  - `case-desert.png` → `desert-parachute`: "A weathered unopened parachute
    pack half sunk in wind-sculpted desert sand at blue twilight, with one
    wooden match in sharp foreground. Distant layered dunes and faint storm
    haze, dramatic low amber light scraping the sand. No aircraft, no
    people."
  - `case-gas-station.png` → `avoided-gas-station`: "An isolated vintage gas
    station on a rural highway at blue hour, warm canopy light over empty
    pumps. Foreground road curves past the station without entering, a
    distant car's red taillights receding. Damp asphalt catching
    reflections, quiet unease. No readable signs, brands or numbers, no
    people."
  - `case-shoes.png` → `discarded-shoes`: "An elegant brand-new pair of dark
    burgundy women's shoes partly inside a small wastebasket beside an
    opened shoe box in a dim apartment entryway. Soft amber light through a
    half-open door, blue window shadows, strong clear shoe silhouette.
    Tasteful, unsettling, no injury, no medical objects, no people."
  - `case-straw.png` → `man-and-straw`: "A single drinking straw on worn
    dark parquet floor beside the edge of a pool of window light; a fallen
    tumbler lies nearby, long noir shadows and a partly open door in the
    distant background. Macro foreground clue with atmospheric room depth,
    cold teal moonlight and a faint amber lamp. No water or underwater
    equipment, no people, no blood."
  - `case-dinner.png` → `dinner-party-soup`: "A formal candlelit dinner
    table with a steaming porcelain soup bowl in foreground, silver spoon
    resting beside it, an empty pulled-back chair and a second untouched
    place setting in soft background. Rain-dark window, elegant muted
    burgundy napkin, warm candles and deep blue shadows. Distinct from a
    restaurant soup cover: intimate domestic dinner party, emotional
    absence. No people, no recipe or marriage clues."
- **Derivative process**: `scripts/process-images.mjs`'s existing
  `STABLE_COVERS` pipeline — `sharp(src).resize(800, 500, { fit: "cover"
  }).webp({ quality: 72 })` — the same pipeline already used for
  `case-{soup,phone,elevator}.webp`, run against a scratch copy of the five
  source PNGs so re-running the script never had a reason to touch the
  existing four derivatives.
- **Mapping to puzzles**: `case-desert.webp` → `desert-parachute`
  ("Desert Parachute"), `case-gas-station.webp` → `avoided-gas-station`
  ("The Avoided Gas Station"), `case-shoes.webp` → `discarded-shoes`
  ("The Discarded Shoes"), `case-straw.webp` → `man-and-straw` ("The Man and
  the Straw"), `case-dinner.webp` → `dinner-party-soup` ("The Dinner Party
  Soup") — matched by slug in `src/render/covers.ts`, same as every other
  built-in cover. With these five, all eight built-in puzzles now have a
  dedicated cover; `case-archive.webp` remains the fallback solely for
  player-authored shared puzzles with no uploaded cover of their own.
