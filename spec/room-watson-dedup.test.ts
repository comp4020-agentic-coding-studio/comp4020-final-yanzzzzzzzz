import { afterAll, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Unit-level coverage for src/render/room.ts's duplicate-verdict fix (the
// screenshot bug: the player's own question/guess bubble used to ALSO
// inline-render "Your Partner, Watson: <verdict>" on top of the separate
// standalone judge-reply bubble). spec/room-lifecycle.test.ts covers the
// same fix at the HTTP level through a real judge call; this file instead
// calls roomPage() directly so the historical-fallback branch (an old row
// whose verdict was NEVER given its own judge-reply row at all — possible
// under the pre-Gemini judge, which could return an empty `reply`) can be
// constructed deterministically without faking a judge response.
//
// Importing src/render/room.ts pulls in src/db.ts (for formatAutoLabel and
// the Room/Puzzle/QaEntry types), which opens a real sqlite file as a side
// effect of being imported — so, same as spec/migration.test.ts, DATA_DIR is
// pointed at a fresh throwaway directory before that import happens, never
// the shared /data volume spec/global-setup.ts's live server already owns.
const dir = mkdtempSync(join(tmpdir(), "turtle-soup-room-dedup-test-"));
process.env.DATA_DIR = dir;

const { roomPage } = await import("../src/render/room.ts");
const { JUDGE_DISPLAY_NAME } = await import("../src/llm.ts");

afterAll(() => {
  delete process.env.DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const baseRoom = {
  id: "room-1",
  code: "TEST1",
  name: "Test Case",
  puzzle_id: "puzzle-1",
  host_session_id: "sess-1",
  status: "active" as const,
  created_at: "2026-01-01 00:00:00",
};
const basePuzzle = {
  id: "puzzle-1",
  slug: "test-case",
  title: "Test Case",
  premise: "A premise.",
  solution: "A solution.",
  author_session_id: null,
  shared: true,
  cover_path: null,
};
const baseProfile = { nickname: null, avatar: null, bio: null, avatarImage: null };

function render(transcript: Parameters<typeof roomPage>[0]["transcript"]): string {
  return roomPage({
    room: baseRoom,
    puzzle: basePuzzle,
    transcript,
    label: "Mystery Detective #1",
    onlineCount: 1,
    members: [],
    profile: baseProfile,
    participants: 1,
    viewerSessionId: "sess-1",
    isHost: true,
    isAuthor: false,
  });
}

it("renders a current question + its standalone judge-reply row with exactly one Watson verdict, no inline duplicate", () => {
  const html = render([
    {
      id: 1,
      room_id: "room-1",
      session_id: "sess-1",
      kind: "question",
      body: "is it raining",
      verdict: "yes",
      label: "Mystery Detective #1",
      created_at: "2026-01-01 00:00:01",
    },
    {
      id: 2,
      room_id: "room-1",
      session_id: null,
      kind: "system",
      body: "Yes.",
      verdict: null,
      label: null,
      created_at: "2026-01-01 00:00:02",
    },
  ]);

  const entries = [...html.matchAll(/<li class="entry[^>]*>[\s\S]*?<\/li>/g)].map((m) => m[0]);
  const questionEntry = entries.find((e) => e.includes("is it raining"));
  expect(questionEntry).toBeTruthy();
  expect(questionEntry).not.toContain(JUDGE_DISPLAY_NAME);
  expect(questionEntry).not.toContain("entry-verdict");

  const judgeReplies = entries.filter((e) => e.includes("entry-judge-reply"));
  expect(judgeReplies).toHaveLength(1);
  expect(judgeReplies[0]).toContain(JUDGE_DISPLAY_NAME);
  expect(judgeReplies[0]).toContain("Yes");
});

// The historical-fallback case: a genuinely old row that has a verdict but
// NO judge-reply row after it at all (the pre-Gemini judge could return an
// empty `reply`, in which case src/routes/rooms.ts's `if (verdict.reply)`
// guard never inserted a system row). Nothing should be lost — a standalone
// Watson bubble is synthesized from the stored verdict — but it must only
// ever be synthesized when there's truly no judge-reply row to source from.
it("synthesizes a standalone Watson bubble from old inline-only verdict data when no judge-reply row exists, without duplicating when one does", () => {
  const html = render([
    {
      id: 10,
      room_id: "room-1",
      session_id: "sess-1",
      kind: "question",
      body: "an old question with no judge-reply row",
      verdict: "no",
      label: "Mystery Detective #1",
      created_at: "2025-01-01 00:00:01",
    },
    // No system/judge-reply row follows — simulates a pre-Gemini row whose
    // verdict was only ever stored inline on the question entry itself.
    {
      id: 11,
      room_id: "room-1",
      session_id: "sess-1",
      kind: "question",
      body: "a later, normal question with its own judge-reply row",
      verdict: "yes",
      label: "Mystery Detective #1",
      created_at: "2025-01-01 00:01:00",
    },
    {
      id: 12,
      room_id: "room-1",
      session_id: null,
      kind: "system",
      body: "Yes.",
      verdict: null,
      label: null,
      created_at: "2025-01-01 00:01:01",
    },
  ]);

  const entries = [...html.matchAll(/<li class="entry[^>]*>[\s\S]*?<\/li>/g)].map((m) => m[0]);

  const oldQuestion = entries.find((e) => e.includes("an old question with no judge-reply row"));
  expect(oldQuestion).toBeTruthy();
  expect(oldQuestion).not.toContain(JUDGE_DISPLAY_NAME);

  // Exactly one synthesized fallback bubble for the old, reply-less entry.
  const fallbacks = entries.filter((e) => e.includes("entry-judge-reply-fallback"));
  expect(fallbacks).toHaveLength(1);
  expect(fallbacks[0]).toContain(JUDGE_DISPLAY_NAME);
  expect(fallbacks[0]).toContain("No");

  // The later, normal entry (with a real judge-reply row) gets no fallback —
  // only its one real standalone reply, no duplicate.
  const normalReplies = entries.filter(
    (e) => e.includes("entry-judge-reply") && !e.includes("entry-judge-reply-fallback"),
  );
  expect(normalReplies).toHaveLength(1);
  expect(normalReplies[0]).toContain("Yes");

  // Total standalone Watson-labeled bubbles: one synthesized + one real.
  const allJudgeBubbles = entries.filter((e) => e.includes("entry-judge-reply"));
  expect(allJudgeBubbles).toHaveLength(2);
});
