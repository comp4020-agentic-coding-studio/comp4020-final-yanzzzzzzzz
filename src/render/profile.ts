import type { Profile } from "../db.ts";
import { layout } from "./layout.ts";
import { escapeHtml } from "./html.ts";
import { asset } from "./asset.ts";
import { resolveAvatarImage } from "./avatars.ts";
import { AVATAR_EMOJIS } from "../avatar-options.ts";

// Re-exported from src/avatar-options.ts (not defined here) so src/db.ts
// can check "is this an emoji I should prefix onto a nickname" without
// importing this render module (and the avatars.ts -> db.ts import it
// carries) and creating a cycle.
export const AVATARS = AVATAR_EMOJIS;

export function profilePage(args: {
  profile: Profile;
  stats: { participated: number; solved: number };
  saved?: boolean;
  notice?: string;
  draft?: { nickname?: string; bio?: string };
}): string {
  const { profile, stats, saved, notice, draft } = args;
  const currentAvatarSrc = resolveAvatarImage({ avatarImage: profile.avatarImage, avatar: profile.avatar });
  // A draft nickname/bio only ever arrives via GET /profile's own query
  // params (routes/profile.ts's draftParams(), round-tripped there after a
  // redirect from the OTHER form's submit) — it wins over the saved value
  // purely so an unsaved edit isn't visually lost across that redirect; it
  // is never itself persisted anywhere.
  const nicknameValue = draft?.nickname ?? profile.nickname ?? "";
  const bioValue = draft?.bio ?? profile.bio ?? "";
  return layout(
    "Your profile · Turtle Soup Puzzle Room",
    `
    <section class="profile-card">
      <h1 class="profile-heading">Your detective profile</h1>
      <p class="profile-intro">
        A name and a face for your next case.
      </p>
      <p class="profile-hint">
        Leave your nickname blank to use Mystery Detective.
      </p>
      ${saved ? `<p class="profile-notice" role="status">Saved.</p>` : ""}
      ${notice ? `<p class="profile-notice" role="status">${escapeHtml(notice)}</p>` : ""}

      <div class="profile-avatar-area">
        <div class="profile-avatar-current">
          <img src="${escapeHtml(currentAvatarSrc)}" alt="" width="96" height="96" class="profile-avatar-preview" id="avatar-preview" />
        </div>

        <form method="post" action="/profile/avatar" enctype="multipart/form-data" class="avatar-upload-form" id="avatar-upload-form">
          <label for="avatarFile" class="profile-field-label">Upload a custom avatar (optional)</label>
          <div class="profile-upload-field">
            <input type="file" id="avatarFile" name="avatarFile" accept="image/jpeg,image/png,image/webp" class="visually-hidden" aria-describedby="avatar-status avatar-hint" />
            <label for="avatarFile" class="profile-upload-choose button-link-outline">Choose image</label>
            <span class="profile-upload-status" id="avatar-status" aria-live="polite">No image selected</span>
          </div>
          <p class="profile-upload-hint" id="avatar-hint">JPEG, PNG, or WebP, up to 2 MiB. No GIF or SVG.</p>
          <!-- Populated by public/profile-avatar.js just before submit, from
               the nickname/bio form below, purely so an in-progress edit
               there survives the redirect this upload causes — never a saved
               value on its own, see routes/profile.ts's draftParams(). -->
          <input type="hidden" name="draftNickname" id="draft-nickname" value="" />
          <input type="hidden" name="draftBio" id="draft-bio" value="" />
          <button type="submit" class="profile-upload-submit button-link-outline">Upload avatar</button>
          ${
            profile.avatarImage
              ? `<button type="submit" formaction="/profile/avatar/remove" class="profile-upload-remove">Remove uploaded avatar</button>`
              : ""
          }
        </form>
      </div>

      <form method="post" action="/profile" id="profile-text-form" class="profile-text-form">
        <!-- Current avatar value is preserved as-is; the visible emoji/preset
             picker was removed, but the form POST contract (routes/profile.ts)
             still expects an "avatar" field, so it round-trips unchanged. -->
        <input type="hidden" name="avatar" value="${escapeHtml(profile.avatar ?? "")}" />

        <label for="nickname">Nickname</label>
        <input
          type="text"
          id="nickname"
          name="nickname"
          maxlength="24"
          autocomplete="off"
          value="${escapeHtml(nicknameValue)}"
        />

        <label for="bio">One-line bio</label>
        <input
          type="text"
          id="bio"
          name="bio"
          maxlength="140"
          autocomplete="off"
          value="${escapeHtml(bioValue)}"
        />

        <button type="submit">Save</button>
      </form>

      <p class="profile-stats">
        Joined <strong>${stats.participated}</strong> case${stats.participated === 1 ? "" : "s"},
        solved <strong>${stats.solved}</strong> of them.
      </p>
    </section>
    <script src="${asset("/profile-avatar.js")}"></script>
    `,
    profile,
  );
}
