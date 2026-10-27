import type { Profile } from "../db.ts";
import { layout } from "./layout.ts";
import { escapeHtml } from "./html.ts";

// A room code is the one thing a visitor types by hand (the "Have a code?"
// box, or a link copied wrong) — a bare 404 there reads as the site being
// broken, not as a typo. Everything else behind a room code (ask, start,
// transfer-host, the stream) is reached only by clicking something this
// page already rendered correctly, never typed, so those keep the plain
// Hono 404 — this friendly page is specifically for the one route someone
// can reach by guessing wrong.
export function roomNotFoundPage(code: string, profile: Profile): string {
  return layout(
    "Case not found · Turtle Soup Puzzle Room",
    `
    <section class="not-found">
      <h1>No case with that code</h1>
      <p>"<strong>${escapeHtml(code)}</strong>" isn't an open case — it may have been
      typed wrong, or the case has already ended.</p>
      <div class="not-found-actions">
        <a href="/" class="button-link">Back to the lobby</a>
      </div>
    </section>
    `,
    profile,
  );
}
