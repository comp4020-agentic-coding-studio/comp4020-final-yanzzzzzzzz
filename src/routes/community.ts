import { Hono } from "hono";
import {
  getOwnReview,
  getProfile,
  isPuzzleAvailable,
  lastReviewWriteAt,
  listAvailablePuzzles,
  listReviews,
  upsertReview,
} from "../db.ts";
import { getOrCreateSessionId } from "../session.ts";
import { isSameOrigin } from "../same-origin.ts";
import { communityPage } from "../render/community.ts";

const MAX_BODY_LENGTH = 2000;
const MIN_BODY_LENGTH = 1;
const POST_COOLDOWN_MS = 5_000;

const NOTICES: Record<string, string> = {
  "missing-story": "Pick a story to review.",
  "unavailable-story": "That story isn't open for reviews — it may be private or no longer exist.",
  "empty-review": "Write a few words before posting your review.",
  "too-long": "That review is too long — keep it under 2000 characters.",
  "bad-rating": "That rating isn't valid — pick 1 to 5 stars, or none.",
  cooldown: "Slow down — wait a few seconds between posting or updating reviews.",
};

export const communityRoute = new Hono();

// Shared between GET (initial render) and POST-with-a-rejection (re-render
// the form with the same notice) — never selects `solution`, same guarantee
// listAvailablePuzzles() already gives the room-creation picker: a private
// puzzle can't leak into the story dropdown just by existing.
function puzzleOptions() {
  return listAvailablePuzzles().map((p) => ({ id: p.id, title: p.title }));
}

communityRoute.get("/community", (c) => {
  const sessionId = getOrCreateSessionId(c);
  const profile = getProfile(sessionId);
  const puzzles = puzzleOptions();

  const requestedPuzzleId = c.req.query("puzzleId");
  // Same rule as GET /rooms/new's ?puzzleId= handling: an id that isn't
  // currently a public puzzle just falls back to "no filter" rather than
  // confirming or denying its existence, so a private puzzle's id can't be
  // probed via this query param either.
  const selectedPuzzleId =
    requestedPuzzleId && isPuzzleAvailable(requestedPuzzleId) ? requestedPuzzleId : undefined;

  const reviews = listReviews(selectedPuzzleId);
  const ownReview = selectedPuzzleId ? getOwnReview(selectedPuzzleId, sessionId) : undefined;
  const notice = NOTICES[c.req.query("notice") ?? ""];
  const saved = c.req.query("saved") === "1";

  return c.html(
    communityPage({
      puzzles,
      reviews,
      profile,
      viewerSessionId: sessionId,
      selectedPuzzleId,
      ownReview,
      notice,
      saved,
    }),
  );
});

communityRoute.post("/community", async (c) => {
  if (!isSameOrigin(c)) return c.body(null, 403);

  const sessionId = getOrCreateSessionId(c);
  const body = await c.req.parseBody();

  const puzzleId = typeof body.puzzleId === "string" ? body.puzzleId : "";
  if (!puzzleId) return c.redirect("/community?notice=missing-story", 303);
  // Re-checked here, not just trusted from the <select>'s own options: a
  // puzzle can be unshared between the page rendering and this POST landing,
  // and a non-browser client can submit any id directly.
  if (!isPuzzleAvailable(puzzleId)) {
    return c.redirect("/community?notice=unavailable-story", 303);
  }

  const reviewBody = String(body.body ?? "").trim();
  if (reviewBody.length < MIN_BODY_LENGTH) {
    return c.redirect(`/community?puzzleId=${encodeURIComponent(puzzleId)}&notice=empty-review`, 303);
  }
  if (reviewBody.length > MAX_BODY_LENGTH) {
    return c.redirect(`/community?puzzleId=${encodeURIComponent(puzzleId)}&notice=too-long`, 303);
  }

  const rawRating = String(body.rating ?? "").trim();
  let rating: number | null = null;
  if (rawRating) {
    const parsed = Number(rawRating);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
      return c.redirect(`/community?puzzleId=${encodeURIComponent(puzzleId)}&notice=bad-rating`, 303);
    }
    rating = parsed;
  }

  const spoiler = body.spoiler === "on";

  // A per-session posting cooldown, same spirit as rooms.ts's per-session
  // question cooldown: slows down rapid repeat submissions without needing
  // an account or a CAPTCHA. Checked against this session's most recent
  // review write across ANY story, not just this one, since the UNIQUE
  // (puzzle_id, session_id) constraint already caps "how many reviews for
  // this one story" at one.
  const last = lastReviewWriteAt(sessionId);
  if (last) {
    const lastMs = Date.parse(`${last.replace(" ", "T")}Z`);
    if (Date.now() - lastMs < POST_COOLDOWN_MS) {
      return c.redirect(`/community?puzzleId=${encodeURIComponent(puzzleId)}&notice=cooldown`, 303);
    }
  }

  upsertReview({ puzzleId, sessionId, rating, body: reviewBody, spoiler });
  return c.redirect(`/community?puzzleId=${encodeURIComponent(puzzleId)}&saved=1`, 303);
});
