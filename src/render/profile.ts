import type { Profile } from "../db.ts";
import { layout } from "./layout.ts";
import { escapeHtml } from "./html.ts";
import { asset } from "./asset.ts";
import { AVATAR_PRESETS, resolveAvatarImage } from "./avatars.ts";
import { AVATAR_EMOJIS } from "../avatar-options.ts";

// A small fixed set rather than free-form emoji input: no moderation
// surface, and it still lets a member-list chip or a transcript line carry
// a glanceable identity beyond "Mystery Detective #3". Sits alongside the
// AI-generated image presets (AVATAR_PRESETS) and the uploaded-image option
// below as three ways to pick the same one `avatar` radio-group value.
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
    <section class="profile">
      <h1>Your profile</h1>
      <p>
        No account needed — this is tied to the anonymous session already in
        your browser. Leave the nickname blank to stay
        "Mystery Detective #N" in every room.
      </p>
      ${saved ? `<p class="notice" role="status">Saved.</p>` : ""}
      ${notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : ""}

      <div class="profile-avatar-current">
        <img src="${escapeHtml(currentAvatarSrc)}" alt="" width="96" height="96" class="profile-avatar-preview" id="avatar-preview" />
      </div>

      <form method="post" action="/profile/avatar" enctype="multipart/form-data" class="avatar-upload-form" id="avatar-upload-form">
        <label for="avatarFile" class="case-file-field-label">Upload a custom avatar (optional)</label>
        <div class="case-file-cover-field">
          <input type="file" id="avatarFile" name="avatarFile" accept="image/jpeg,image/png,image/webp" class="visually-hidden" aria-describedby="avatar-status avatar-hint" />
          <label for="avatarFile" class="case-file-cover-choose button-link-outline">Choose image</label>
          <span class="case-file-cover-status" id="avatar-status" aria-live="polite">No image selected</span>
        </div>
        <p class="case-file-cover-hint" id="avatar-hint">JPEG, PNG, or WebP, up to 2 MiB. No GIF or SVG.</p>
        <!-- Populated by public/profile-avatar.js just before submit, from
             the nickname/bio form below, purely so an in-progress edit
             there survives the redirect this upload causes — never a saved
             value on its own, see routes/profile.ts's draftParams(). -->
        <input type="hidden" name="draftNickname" id="draft-nickname" value="" />
        <input type="hidden" name="draftBio" id="draft-bio" value="" />
        <button type="submit" class="button-link-outline">Upload avatar</button>
        ${
          profile.avatarImage
            ? `<button type="submit" formaction="/profile/avatar/remove" class="case-file-cover-remove">Remove uploaded avatar</button>`
            : ""
        }
      </form>

      <form method="post" action="/profile" id="profile-text-form">
        <label for="nickname">Nickname</label>
        <input
          type="text"
          id="nickname"
          name="nickname"
          maxlength="24"
          autocomplete="off"
          value="${escapeHtml(nicknameValue)}"
        />

        <fieldset class="avatar-picker">
          <legend>Emoji / preset avatar</legend>
          <p class="case-file-cover-hint">Used only when no custom image is uploaded above.</p>
          ${AVATARS.map(
            (a) => `<label class="avatar-option">
              <input type="radio" name="avatar" value="${a}" ${profile.avatar === a ? "checked" : ""} />
              <span>${a}</span>
            </label>`,
          ).join("\n")}
          ${AVATAR_PRESETS.map(
            (p) => `<label class="avatar-option avatar-option-image">
              <input type="radio" name="avatar" value="${p.id}" ${profile.avatar === p.id ? "checked" : ""} />
              <img src="${escapeHtml(p.src)}" alt="${escapeHtml(p.label)}" width="32" height="32" />
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
