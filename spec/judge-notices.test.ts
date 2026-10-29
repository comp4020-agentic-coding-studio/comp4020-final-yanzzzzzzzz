import { describe, expect, test } from "vitest";
import { isLegacyJudgeConfigNotice } from "../src/judge-notices.ts";

describe("isLegacyJudgeConfigNotice", () => {
  test("matches the legacy GROQ_API_KEY notice", () => {
    expect(
      isLegacyJudgeConfigNotice(
        "The AI judge isn't configured on this deploy (no GROQ_API_KEY) — this case can't be judged right now. See README.md's \"Running locally\" / ops notes.",
      ),
    ).toBe(true);
  });

  test("matches the legacy GEMINI_API_KEY notice", () => {
    expect(
      isLegacyJudgeConfigNotice(
        "The AI judge isn't configured on this deploy (no GEMINI_API_KEY) — this case can't be judged right now. See README.md's \"Running locally\" / ops notes.",
      ),
    ).toBe(true);
  });

  test("rejects unrelated errors", () => {
    expect(isLegacyJudgeConfigNotice("Watson is unavailable right now. Please try again later.")).toBe(false);
    expect(isLegacyJudgeConfigNotice("The judge call timed out. Please try again.")).toBe(false);
    expect(isLegacyJudgeConfigNotice("Judge request failed with 429. Please try again shortly.")).toBe(false);
  });
});
