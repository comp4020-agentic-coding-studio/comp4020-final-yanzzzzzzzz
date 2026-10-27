import type { Puzzle, QaEntry } from "./db.ts";

export interface Verdict {
  verdict: "yes" | "no" | "irrelevant" | "correct";
  reply: string;
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const TIMEOUT_MS = 10_000;

function systemPrompt(puzzle: Puzzle, kind: "question" | "guess"): string {
  const base = [
    "You are the judge for a game of \"turtle soup\" (a lateral-thinking puzzle). You know the full solution; the player only sees the premise.",
    "",
    `Premise: ${puzzle.premise}`,
    `Solution (never reveal this directly unless the player's guess already amounts to it): ${puzzle.solution}`,
    "",
    "Output only a JSON object shaped like {\"verdict\": \"yes\"|\"no\"|\"irrelevant\"|\"correct\", \"reply\": \"one short sentence\"}.",
  ];
  const verdictMeaning =
    kind === "guess"
      ? [
          "The player is submitting their FINAL GUESS at the solution, not a yes/no question — judge whether it captures the core of the solution, nothing else.",
          "- correct: the guess captures the core of the solution",
          "- no: the guess does not capture the core of the solution",
          "Never answer a guess with \"yes\" or \"irrelevant\" — a guess is either correct or it isn't.",
        ]
      : [
          "The player is asking a yes/no question about the solution, not guessing it outright.",
          "- yes: the question is consistent with the solution",
          "- no: the question contradicts the solution",
          "- irrelevant: the question is unrelated to the solution, or nothing in the solution can answer it",
          "Never answer a question with \"correct\" — that verdict is reserved for final guesses.",
        ];
  return [...base, ...verdictMeaning, "reply must never leak any part of the solution that the verdict hasn't already confirmed."].join(
    "\n",
  );
}

function historyAsMessages(
  history: QaEntry[],
): { role: "user" | "assistant"; content: string }[] {
  return history
    .filter((e) => e.kind !== "system")
    .slice(-20)
    .flatMap((e) => [
      { role: "user" as const, content: e.body },
      { role: "assistant" as const, content: e.verdict ?? "irrelevant" },
    ]);
}

function parseVerdict(raw: string): Verdict | undefined {
  try {
    const parsed = JSON.parse(raw);
    const verdict = parsed.verdict;
    const reply = parsed.reply;
    if (
      typeof reply === "string" &&
      (verdict === "yes" || verdict === "no" || verdict === "irrelevant" || verdict === "correct")
    ) {
      return { verdict, reply };
    }
  } catch {
    // falls through to undefined — caller treats this as a judge failure
  }
  return undefined;
}

// A guess can only ever land as "correct" or "no" — clamps a model's answer
// that didn't follow the prompt's instruction, rather than trusting it blind.
function clampToKind(verdict: Verdict, kind: "question" | "guess"): Verdict {
  if (kind === "guess" && (verdict.verdict === "yes" || verdict.verdict === "irrelevant")) {
    return { ...verdict, verdict: "no" };
  }
  if (kind === "question" && verdict.verdict === "correct") {
    return { ...verdict, verdict: "irrelevant" };
  }
  return verdict;
}

async function judgeWithGroq(
  apiKey: string,
  puzzle: Puzzle,
  history: QaEntry[],
  question: string,
  kind: "question" | "guess",
): Promise<Verdict> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        response_format: { type: "json_object" },
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt(puzzle, kind) },
          ...historyAsMessages(history),
          { role: "user", content: question },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`groq ${res.status}`);
    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    const content = data.choices[0]?.message.content ?? "";
    const verdict = parseVerdict(content);
    if (!verdict) throw new Error("judge returned unparseable output");
    return clampToKind(verdict, kind);
  } finally {
    clearTimeout(timeout);
  }
}

// The mock judge below is deliberately NOT the default fallback for a
// missing GROQ_API_KEY — it only runs when ALLOW_MOCK_JUDGE is explicitly
// set, which CI and local test runs do (see .github/workflows/checks.yml
// and README.md's "Running locally"). A production deploy that forgot to
// set GROQ_API_KEY must not silently start answering every question with
// "mock judge: keyword match" and look like a working AI judge — judge()
// returns undefined in that case instead, same shape as a real judge
// timeout, and the caller shows a plain "AI judge unavailable" state
// (src/routes/rooms.ts's "ai-unavailable" notice) rather than ever
// fabricating a verdict nobody asked for.
function mockJudgeAllowed(): boolean {
  return process.env.ALLOW_MOCK_JUDGE === "1";
}

// Whether the live judge this process would call right now is the real
// Groq-backed one, the deterministic mock (only when explicitly allowed),
// or neither — read fresh each call, not cached, so a key added or removed
// via `flyctl secrets set` (which restarts the machine) is reflected
// immediately rather than from a stale boot-time snapshot.
export function judgeAvailability(): "real" | "mock" | "unavailable" {
  if (process.env.GROQ_API_KEY) return "real";
  if (mockJudgeAllowed()) return "mock";
  return "unavailable";
}

function judgeWithMock(puzzle: Puzzle, question: string, kind: "question" | "guess"): Verdict {
  const q = question.toLowerCase();
  const solutionWords = puzzle.solution
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w.length >= 2);
  const hit = solutionWords.some((w) => q.includes(w.toLowerCase()));
  if (kind === "guess") {
    return hit
      ? { verdict: "correct", reply: "Correct (mock judge: keyword match)" }
      : { verdict: "no", reply: "Not quite (mock judge: GROQ_API_KEY not set)" };
  }
  return hit
    ? { verdict: "yes", reply: "Yes (mock judge: keyword match)" }
    : { verdict: "irrelevant", reply: "Can't tell (mock judge: GROQ_API_KEY not set)" };
}

export async function judge(
  puzzle: Puzzle,
  history: QaEntry[],
  question: string,
  kind: "question" | "guess" = "question",
): Promise<Verdict | undefined> {
  const availability = judgeAvailability();
  if (availability === "unavailable") return undefined;
  if (availability === "mock") return judgeWithMock(puzzle, question, kind);
  try {
    return await judgeWithGroq(process.env.GROQ_API_KEY as string, puzzle, history, question, kind);
  } catch {
    // caller inserts a system "AI didn't respond" entry instead of failing silently
    return undefined;
  }
}
