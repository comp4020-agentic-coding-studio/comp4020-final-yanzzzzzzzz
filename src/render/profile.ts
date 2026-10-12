import type { Profile } from "../db.ts";
import { layout } from "./layout.ts";
import { escapeHtml } from "./html.ts";

// A small fixed set rather than free-form upload or URL input: no image
// hosting, no moderation surface, and it still lets a member-list chip or a
// transcript line carry a glanceable identity beyond "Anonymous Detective#3".
export const AVATARS = ["🕵️", "🔍", "🐢", "🔦", "🧩", "🗝️", "📖", "🧠"];

export function profilePage(args: {
  profile: Profile;
  stats: { participated: number; solved: number };
  saved?: boolean;
}): string {
  const { profile, stats, saved } = args;
  return layout(
    "Your profile · Turtle Soup Puzzle Room",
    `
    <section class="profile">
      <h1>Your profile</h1>
      <p>
        No account needed — this is tied to the anonymous session already in
        your browser. Leave the nickname blank to stay
        "Anonymous Detective#N" in every room.
      </p>
      ${saved ? `<p class="notice" role="status">Saved.</p>` : ""}

      <form method="post" action="/profile">
        <label for="nickname">Nickname</label>
        <input
          type="text"
          id="nickname"
          name="nickname"
          maxlength="24"
          autocomplete="off"
          value="${escapeHtml(profile.nickname ?? "")}"
        />

        <fieldset class="avatar-picker">
          <legend>Avatar</legend>
          ${AVATARS.map(
            (a) => `<label class="avatar-option">
              <input type="radio" name="avatar" value="${a}" ${profile.avatar === a ? "checked" : ""} />
              <span>${a}</span>
            </label>`,
          ).join("\n")}
          <label class="avatar-option">
            <input type="radio" name="avatar" value="" ${!profile.avatar ? "checked" : ""} />
            <span>None</span>
          </label>
        </fieldset>

        <label for="bio">One-line bio</label>
        <input
          type="text"
          id="bio"
          name="bio"
          maxlength="140"
          autocomplete="off"
          value="${escapeHtml(profile.bio ?? "")}"
        />

        <button type="submit">Save</button>
      </form>

      <p class="profile-stats">
        Joined <strong>${stats.participated}</strong> case${stats.participated === 1 ? "" : "s"},
        solved <strong>${stats.solved}</strong> of them.
      </p>
    </section>
    `,
    profile,
  );
}
