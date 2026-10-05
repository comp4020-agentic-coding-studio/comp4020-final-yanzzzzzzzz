import type { Puzzle, QaEntry } from "./db.ts";

export interface Verdict {
  verdict: "yes" | "no" | "irrelevant" | "correct";
  reply: string;
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const TIMEOUT_MS = 10_000;

function systemPrompt(puzzle: Puzzle): string {
  return [
    "You are the judge for a game of \"turtle soup\" (a lateral-thinking puzzle). You know the full solution; the player only sees the premise.",
    "The player will ask yes/no questions, or submit a final guess.",
    "",
    `Premise: ${puzzle.premise}`,
    `Solution (never reveal this directly unless the player's guess already amounts to it): ${puzzle.solution}`,
    "",
    "Output only a JSON object shaped like {\"verdict\": \"yes\"|\"no\"|\"irrelevant\"|\"correct\", \"reply\": \"one short sentence\"}.",
    "What each verdict means:",
    "- yes: the question is consistent with the solution",
    "- no: the question contradicts the solution",
    "- irrelevant: the question is unrelated to the solution, or nothing in the solution can answer it",
    "- correct: this was a guess, and it already captures the core of the solution",
    "reply must never leak any part of the solution that the verdict hasn't already confirmed.",
  ].join("\n");
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

async function judgeWithGroq(
  apiKey: string,
  puzzle: Puzzle,
  history: QaEntry[],
  question: string,
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
          { role: "system", content: systemPrompt(puzzle) },
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
    return verdict;
  } finally {
    clearTimeout(timeout);
  }
}

// Used only when GROQ_API_KEY is unset — always true in CI, since the
// course's LLM proxy key is ANU-network-restricted and can't be reached from
// a Fly machine or a GitHub runner. Keeps `pnpm check` deterministic and free
// of a third-party secret; production always has a real key.
function judgeWithMock(puzzle: Puzzle, question: string): Verdict {
  const q = question.toLowerCase();
  const solutionWords = puzzle.solution
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w.length >= 2);
  const hit = solutionWords.some((w) => q.includes(w.toLowerCase()));
  return hit
    ? { verdict: "yes", reply: "Yes (mock judge: keyword match)" }
    : { verdict: "irrelevant", reply: "Can't tell (mock judge: GROQ_API_KEY not set)" };
}

export async function judge(
  puzzle: Puzzle,
  history: QaEntry[],
  question: string,
): Promise<Verdict | undefined> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return judgeWithMock(puzzle, question);
  try {
    return await judgeWithGroq(apiKey, puzzle, history, question);
  } catch {
    // caller inserts a system "AI didn't respond" entry instead of failing silently
    return undefined;
  }
}
