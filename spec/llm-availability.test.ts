import { afterEach, expect, it } from "vitest";
import { judge, judgeAvailability } from "../src/llm.ts";
import type { Puzzle } from "../src/db.ts";

// Unlike every other spec/*.test.ts, this one doesn't hit the live server —
// judgeAvailability()/judge() are pure functions of process.env, and the
// thing under test (a production deploy with no GROQ_API_KEY and no
// explicit ALLOW_MOCK_JUDGE opt-in) is a state the live test server never
// runs in — it always carries ALLOW_MOCK_JUDGE=1 locally and in CI, same as
// production always carries a real GROQ_API_KEY. Exercising it any other
// way would mean spinning up a second server process with a different
// environment, for a check that's really about src/llm.ts's own logic.
const ORIGINAL_GROQ_KEY = process.env.GROQ_API_KEY;
const ORIGINAL_ALLOW_MOCK = process.env.ALLOW_MOCK_JUDGE;

afterEach(() => {
  if (ORIGINAL_GROQ_KEY === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = ORIGINAL_GROQ_KEY;
  if (ORIGINAL_ALLOW_MOCK === undefined) delete process.env.ALLOW_MOCK_JUDGE;
  else process.env.ALLOW_MOCK_JUDGE = ORIGINAL_ALLOW_MOCK;
});

const FAKE_PUZZLE: Puzzle = {
  id: "p1",
  slug: null,
  title: "Test",
  premise: "A premise.",
  solution: "A specific solution phrase.",
  author_session_id: null,
  shared: true,
  cover_path: null,
};

it("is unavailable with neither GROQ_API_KEY nor ALLOW_MOCK_JUDGE set — the real misconfigured-production shape", async () => {
  delete process.env.GROQ_API_KEY;
  delete process.env.ALLOW_MOCK_JUDGE;
  expect(judgeAvailability()).toBe("unavailable");
  // judge() itself must also refuse to fabricate a verdict in this state,
  // not just report "unavailable" while still answering.
  const verdict = await judge(FAKE_PUZZLE, [], "is it a person", "question");
  expect(verdict).toBeUndefined();
});

it("is mock only when ALLOW_MOCK_JUDGE is explicitly set, never as an unannounced default", async () => {
  delete process.env.GROQ_API_KEY;
  process.env.ALLOW_MOCK_JUDGE = "1";
  expect(judgeAvailability()).toBe("mock");
  const verdict = await judge(FAKE_PUZZLE, [], "solution phrase", "question");
  expect(verdict?.reply).toContain("mock judge");
});

it("prefers the real judge whenever GROQ_API_KEY is set, regardless of ALLOW_MOCK_JUDGE", async () => {
  process.env.GROQ_API_KEY = "fake-key-for-this-check-only";
  process.env.ALLOW_MOCK_JUDGE = "1";
  expect(judgeAvailability()).toBe("real");
});
