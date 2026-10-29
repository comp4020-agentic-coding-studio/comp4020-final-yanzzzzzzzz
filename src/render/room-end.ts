import type { Profile, Room } from "../db.ts";
import { layout } from "./layout.ts";
import { escapeHtml } from "./html.ts";

// A plain SSR confirmation page for POST /rooms/:code/end — no JS confirm()
// dialog, so the host's "end this for everyone" action is still reachable
// and safe to use with JS off. Two plain links, not a link + a styled
// button doing different things: "End investigation" is the one real <form>
// submit here, "Cancel" is just a link back to the room.
export function endConfirmPage(room: Room, profile: Profile): string {
  return layout(
    "End investigation? · Turtle Soup Puzzle Room",
    `
    <section class="end-confirm">
      <h1>End this investigation?</h1>
      <p>This closes case <strong>${escapeHtml(room.code)}</strong> for everyone right now.
      It stays <strong>unsolved</strong> — the transcript is kept, but nobody can ask
      another question or submit a guess afterward.</p>
      <div class="end-confirm-actions">
        <form method="post" action="/rooms/${room.code}/end">
          <input type="hidden" name="confirm" value="end" />
          <button type="submit" class="end-confirm-button">End investigation</button>
        </form>
        <a href="/rooms/${room.code}" class="end-cancel-link">Cancel</a>
      </div>
    </section>
    `,
    profile,
  );
}
