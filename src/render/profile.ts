import type { InvestigationHistoryEntry, OwnStoryEntry, Profile } from "../db.ts";
import { layout } from "./layout.ts";
import { escapeHtml } from "./html.ts";
import { asset } from "./asset.ts";
import { resolveAvatarImage } from "./avatars.ts";
import { AVATAR_EMOJIS } from "../avatar-options.ts";
import { coverFor } from "./covers.ts";

// Re-exported from src/avatar-options.ts (not defined here) so src/db.ts
// can check "is this an emoji I should prefix onto a nickname" without
// importing this render module (and the avatars.ts -> db.ts import it
// carries) and creating a cycle.
export const AVATARS = AVATAR_EMOJIS;

const STATUS_LABEL: Record<InvestigationHistoryEntry["status"], string> = {
  waiting: "Waiting",
  active: "In progress",
  // Never "you solved it" — a room reaching 'solved' only means SOMEONE in
  // it submitted the correct final guess, not necessarily this viewer.
  solved: "Solved together",
  ended: "Ended unsolved",
};

// `joinedAtUtc` is stored as SQLite's `datetime('now')` text (UTC, no
// timezone suffix) — appended explicitly here so the profile page never
// implies a local time it didn't actually compute.
function formatUtc(sqliteDatetime: string): string {
  return `${sqliteDatetime.replace(" ", "T")}Z`.replace(/\.\d+Z$/, "Z");
}

function formatUtcLabel(sqliteDatetime: string): string {
  return new Date(formatUtc(sqliteDatetime)).toLocaleString("en-GB", {
    timeZone: "UTC", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }) + " UTC";
}

function paginationHtml(
  basePath: string,
  pageParam: string,
  page: number,
  total: number,
  pageSize: number,
): string {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return "";
  const link = (p: number, label: string): string =>
    `<a href="${basePath}?${pageParam}=${p}#${pageParam === "historyPage" ? "your-investigations" : "your-stories"}" class="button-link-outline">${label}</a>`;
  return `<nav class="profile-pagination" aria-label="Pagination">
    ${page > 1 ? link(page - 1, "Previous") : ""}
    <span class="profile-pagination-status">Page ${page} of ${totalPages}</span>
    ${page < totalPages ? link(page + 1, "Next") : ""}
  </nav>`;
}

function investigationRowHtml(entry: InvestigationHistoryEntry): string {
  const timeHint =
    entry.reasoningSeconds === null
      ? "Not recorded"
      : `${Math.floor(entry.reasoningSeconds / 60)}m ${entry.reasoningSeconds % 60}s`;
  return `<li class="profile-history-row">
    <a href="/rooms/${escapeHtml(entry.roomCode)}" class="profile-history-title">${escapeHtml(entry.puzzleTitle)}</a>
    <span class="profile-history-meta">
      Joined <time datetime="${escapeHtml(formatUtc(entry.joinedAtUtc))}">${escapeHtml(formatUtcLabel(entry.joinedAtUtc))}</time>
      · ${escapeHtml(STATUS_LABEL[entry.status])}
      · Time tracked: ${escapeHtml(timeHint)}
    </span>
  </li>`;
}

function storyRowHtml(entry: OwnStoryEntry): string {
  return `<li class="profile-history-row">
    <img
      class="profile-story-cover"
      src="${coverFor(entry.slug, entry.puzzleId, entry.coverPath)}"
      alt=""
      width="96"
      height="60"
      loading="lazy"
      decoding="async"
    />
    <div>
      <a href="/rooms/new?puzzleId=${encodeURIComponent(entry.puzzleId)}" class="profile-history-title">${escapeHtml(entry.title)}</a>
      <span class="profile-history-meta">
        Created <time datetime="${escapeHtml(formatUtc(entry.createdAtUtc))}">${escapeHtml(formatUtcLabel(entry.createdAtUtc))}</time>
        · ${entry.shared ? "Public" : "Private"}
        · Uploaded by you
      </span>
    </div>
  </li>`;
}

export function profilePage(args: {
  profile: Profile;
  stats: { participated: number; solved: number };
  saved?: boolean;
  notice?: string;
  draft?: { nickname?: string; bio?: string };
  history?: { entries: InvestigationHistoryEntry[]; total: number; page: number; pageSize: number };
  stories?: { entries: OwnStoryEntry[]; total: number; page: number; pageSize: number };
}): string {
  const { profile, stats, saved, notice, draft, history, stories } = args;
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
    <section class="profile-card" id="profile-details">
      <h1 class="profile-heading">Your detective profile</h1>
      <p class="profile-intro">
        A name and a face for your next case.
      </p>
      <p class="profile-hint">
        Leave your nickname blank to use Mystery Detective.
      </p>
      <nav class="profile-section-nav" aria-label="Profile sections">
        <a href="#profile-details">Details</a>
        <a href="#your-investigations">Investigations</a>
        <a href="#your-stories">Your stories</a>
      </nav>
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

    ${history ? investigationsSectionHtml(history) : ""}
    ${stories ? storiesSectionHtml(stories) : ""}

    <script src="${asset("/profile-avatar.js")}"></script>
    `,
    profile,
  );
}

function investigationsSectionHtml(history: {
  entries: InvestigationHistoryEntry[];
  total: number;
  page: number;
  pageSize: number;
}): string {
  return `<section class="profile-history-section" id="your-investigations">
    <h2>Your investigations</h2>
    <p class="profile-history-hint">Cases you've joined, from this browser session only. Time measures active participation; earlier activity may show Not recorded.</p>
    ${
      history.entries.length
        ? `<ul class="profile-history-list">${history.entries.map(investigationRowHtml).join("\n")}</ul>`
        : `<p class="profile-history-empty">You haven't joined any cases yet.</p>`
    }
    ${paginationHtml("/profile", "historyPage", history.page, history.total, history.pageSize)}
  </section>`;
}

function storiesSectionHtml(stories: {
  entries: OwnStoryEntry[];
  total: number;
  page: number;
  pageSize: number;
}): string {
  return `<section class="profile-history-section" id="your-stories">
    <h2>Your stories</h2>
    <p class="profile-history-hint">Cases you've written, public and private.</p>
    ${
      stories.entries.length
        ? `<ul class="profile-history-list">${stories.entries.map(storyRowHtml).join("\n")}</ul>`
        : `<p class="profile-history-empty">You haven't written any cases yet.</p>`
    }
    ${paginationHtml("/profile", "storiesPage", stories.page, stories.total, stories.pageSize)}
  </section>`;
}
