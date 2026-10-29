// A single source of truth for the ask/guess composer's character limit —
// imported by the server route that enforces it (src/routes/rooms.ts) and
// the page that renders the <textarea> advertising it (src/render/room.ts),
// so the two can never drift apart and silently clip a final explanation
// the client-side counter claimed was still within budget.
export const QUESTION_MAX_LENGTH = 2000;
