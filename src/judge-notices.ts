const LEGACY_JUDGE_CONFIG_NOTICES = new Set([
  "The AI judge isn't configured on this deploy (no GROQ_API_KEY) — this case can't be judged right now. See README.md's \"Running locally\" / ops notes.",
  "The AI judge isn't configured on this deploy (no GEMINI_API_KEY) — this case can't be judged right now. See README.md's \"Running locally\" / ops notes.",
]);

export function isLegacyJudgeConfigNotice(body: string): boolean {
  return LEGACY_JUDGE_CONFIG_NOTICES.has(body);
}
