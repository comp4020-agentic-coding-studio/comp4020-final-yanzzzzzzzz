import type { Profile } from "../db.ts";
import { layout } from "./layout.ts";
import { JUDGE_DISPLAY_NAME } from "../llm.ts";

export function aboutPage(profile?: Profile): string {
  return layout(
    "About · Turtle Soup Puzzle Room",
    `
    <section class="about">
      <h1>About Turtle Soup</h1>
      <p class="hero-blurb">
        Turtle Soup is a multiplayer situational-reasoning game: everyone in a
        room works from the same strange premise and reasons out loud together
        until the truth behind it comes together.
      </p>

      <h2>How it plays</h2>
      <ol class="how-it-works">
        <li>
          <span class="step-icon" aria-hidden="true">🥣</span>
          <h3>Read the premise</h3>
          <p>A short, odd scene with no explanation attached.</p>
        </li>
        <li>
          <span class="step-icon" aria-hidden="true">❓</span>
          <h3>Ask questions</h3>
          <p>
            ${JUDGE_DISPLAY_NAME} acts as a shared AI judge when available,
            answering yes / no / irrelevant questions for the whole room to
            see.
          </p>
        </li>
        <li>
          <span class="step-icon" aria-hidden="true">🔎</span>
          <h3>Solve it together</h3>
          <p>
            Piece together the truth with everyone else in the room, then
            submit your own final guess whenever you think you've got it.
          </p>
        </li>
      </ol>

      <p>
        Whoever opens a case picks the puzzle and starts the room; everyone
        else joins with the room's code. No account is needed — just an
        optional nickname.
      </p>

      <p class="content-warning" role="note">
        ⚠️ Some stories contain horror or graphic content. Proceed with caution.
      </p>

      <div class="hero-actions">
        <a href="/rooms/new" class="button-link">Start a new case</a>
        <a href="/" class="button-link-outline">Back to lobby</a>
      </div>

      <h2 id="music-credits">Music credits</h2>
      <p>
        Background music is <a href="https://opengameart.org/content/creepy-ambient-loop">"Creepy Ambient Loop"</a>
        by epb9000, released under
        <a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0 (public domain)</a>.
        See <a href="/readme/">technical documentation</a> and <code>ASSET_LICENSES.md</code> for the full attribution.
      </p>
    </section>
    `,
    profile,
  );
}
