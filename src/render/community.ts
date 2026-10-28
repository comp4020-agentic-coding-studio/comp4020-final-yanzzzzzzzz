import type { Profile, StoryReview } from "../db.ts";
import { layout } from "./layout.ts";
import { escapeHtml } from "./html.ts";

export interface CommunityPuzzleOption {
  id: string;
  title: string;
}

// Room timestamps/review timestamps both come back from SQLite as
// "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker — same parse src/render/
// room.ts and src/routes/rooms.ts's cooldown check already use.
function formatReviewDate(sqliteTimestamp: string): string {
  const ms = Date.parse(`${sqliteTimestamp.replace(" ", "T")}Z`);
  return new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function starsHtml(rating: number | null): string {
  if (rating == null) return `<span class="review-rating-none">No rating given</span>`;
  const filled = "★".repeat(rating);
  const empty = "☆".repeat(5 - rating);
  return `<span class="review-rating" aria-label="${rating} out of 5 stars">${filled}${empty}</span>`;
}

function reviewBodyHtml(review: StoryReview): string {
  // escapeHtml() already prevents any markup injection; newlines survive as
  // literal characters and are rendered as line breaks by the CSS's
  // `white-space: pre-wrap` rather than by inserting unescaped <br> tags.
  const body = `<p class="review-body">${escapeHtml(review.body)}</p>`;
  if (!review.spoiler) return body;
  return `<details class="review-spoiler">
    <summary>Contains spoilers — click to reveal</summary>
    ${body}
  </details>`;
}

function reviewCardHtml(review: StoryReview, viewerSessionId: string): string {
  const avatar = review.reviewerAvatar ? `${escapeHtml(review.reviewerAvatar)} ` : "";
  const mine = review.sessionId === viewerSessionId ? `<span class="review-mine">Your review</span>` : "";
  return `<li class="review-card">
    <p class="review-meta">
      <span class="review-author">${avatar}${escapeHtml(review.reviewerLabel)}</span>
      · <a href="/community?puzzleId=${encodeURIComponent(review.puzzleId)}">${escapeHtml(review.puzzleTitle)}</a>
      · <time>${formatReviewDate(review.createdAt)}</time>
      ${mine}
    </p>
    ${starsHtml(review.rating)}
    ${reviewBodyHtml(review)}
  </li>`;
}

function ratingOptionsHtml(selected: number | null): string {
  const options = [
    `<option value=""${selected == null ? " selected" : ""}>No rating</option>`,
  ];
  for (let i = 1; i <= 5; i++) {
    options.push(`<option value="${i}"${selected === i ? " selected" : ""}>${i} star${i === 1 ? "" : "s"}</option>`);
  }
  return options.join("\n");
}

export function communityPage(args: {
  puzzles: CommunityPuzzleOption[];
  reviews: StoryReview[];
  profile: Profile;
  viewerSessionId: string;
  selectedPuzzleId?: string;
  ownReview?: StoryReview;
  notice?: string;
  saved?: boolean;
}): string {
  const { puzzles, reviews, profile, viewerSessionId, selectedPuzzleId, ownReview, notice, saved } = args;
  const selectedPuzzle = puzzles.find((p) => p.id === selectedPuzzleId);
  const heading = selectedPuzzle ? `Reviews for ${escapeHtml(selectedPuzzle.title)}` : "Community reviews";

  const puzzleOptions = puzzles
    .map(
      (p) =>
        `<option value="${p.id}"${p.id === selectedPuzzleId ? " selected" : ""}>${escapeHtml(p.title)}</option>`,
    )
    .join("\n");

  return layout(
    "Community · Turtle Soup Puzzle Room",
    `
    <section class="community">
      <h1>${heading}</h1>
      <p class="community-blurb">
        Real reviews from players who've played a public case — what worked,
        what didn't, and how it felt to solve. No login needed: your anonymous
        session can post one review per story, and you can come back and
        update it any time.
      </p>
      ${selectedPuzzle ? `<p><a href="/community">See every story's reviews</a></p>` : ""}

      ${saved ? `<p class="notice" role="status">Your review was saved.</p>` : ""}
      ${notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : ""}

      <form method="post" action="/community" class="review-form">
        <label for="puzzleId">Story</label>
        <select id="puzzleId" name="puzzleId" required>
          <option value="">Choose a story…</option>
          ${puzzleOptions}
        </select>

        <label for="rating">Rating (optional)</label>
        <select id="rating" name="rating">
          ${ratingOptionsHtml(ownReview?.rating ?? null)}
        </select>

        <label for="body">Your review</label>
        <textarea id="body" name="body" maxlength="2000" required rows="4">${escapeHtml(ownReview?.body ?? "")}</textarea>

        <label class="checkbox-label">
          <input type="checkbox" name="spoiler" id="spoiler" ${ownReview?.spoiler ? "checked" : ""} />
          Contains spoilers
        </label>

        <button type="submit">${ownReview ? "Update review" : "Post review"}</button>
      </form>

      <p class="review-list-empty" ${reviews.length ? "hidden" : ""}>
        No reviews yet${selectedPuzzle ? " for this story" : ""} — be the first to write one!
      </p>
      <ul class="review-list">
        ${reviews.map((r) => reviewCardHtml(r, viewerSessionId)).join("\n")}
      </ul>
    </section>
    `,
    profile,
    "community",
  );
}
