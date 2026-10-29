import type { Profile } from "../db.ts";
import { layout } from "./layout.ts";
import { JUDGE_DISPLAY_NAME } from "../llm.ts";
import { escapeHtml } from "./html.ts";

function aboutStepIcon(n: number): string {
  return `<span class="about-step-number" aria-hidden="true">${n}</span>`;
}

export function aboutPage(profile?: Profile): string {
  return layout(
    "About · Turtle Soup Puzzle Room",
    `
    <section class="about">
      <h1>About Turtle Soup</h1>
      <p class="about-intro">
        Turtle Soup is a shared mystery: everyone in a room reads the same
        strange scene and reasons it out together, one question at a time,
        until the truth comes together.
      </p>

      <ol class="about-steps">
        <li>
          ${aboutStepIcon(1)}
          <h3>Read the scene</h3>
          <p>A short, odd premise with no explanation attached.</p>
        </li>
        <li>
          ${aboutStepIcon(2)}
          <h3>Ask ${escapeHtml(JUDGE_DISPLAY_NAME)}</h3>
          <p>Yes, no, or irrelevant — answered for the whole room to see.</p>
        </li>
        <li>
          ${aboutStepIcon(3)}
          <h3>Solve together</h3>
          <p>Piece it together with the room, then submit your guess.</p>
        </li>
      </ol>

      <p class="about-note">
        Whoever opens a case starts the room; everyone else joins with its
        code. No account needed — just an optional nickname.
      </p>

      <div class="about-warning-block">
        <p class="about-warning" role="note">
          Some stories contain horror or graphic content. Proceed with caution.
        </p>
      </div>

      <h2 id="music-credits">Music credits</h2>
      <p class="about-credits">
        Background music is <a href="https://opengameart.org/content/creepy-ambient-loop">"Creepy Ambient Loop"</a>
        by epb9000, released under
        <a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0 (public domain)</a>.
      </p>
    </section>
    `,
    profile,
  );
}
