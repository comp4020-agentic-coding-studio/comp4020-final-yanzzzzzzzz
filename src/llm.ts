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
    "你是「海龟汤」推理游戏的裁判。你知道完整的真相（汤底），玩家只看到谜面（汤面）。",
    "玩家会提问是/否类型的问题，或者提交一个最终猜测。",
    "",
    `谜面：${puzzle.premise}`,
    `真相（绝不能直接告诉玩家，除非玩家的猜测已经基本等同于真相）：${puzzle.solution}`,
    "",
    "只输出一个 JSON 对象，形如 {\"verdict\": \"yes\"|\"no\"|\"irrelevant\"|\"correct\", \"reply\": \"一句简短的回应\"}。",
    "verdict 的含义：",
    "- yes：问题与真相一致",
    "- no：问题与真相矛盾",
    "- irrelevant：问题与真相无关，或真相中没有信息能回答这个问题",
    "- correct：这是一个猜测，并且已经基本说中了真相的核心",
    "reply 绝不能泄露真相中 verdict 没有确认的部分。",
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
    ? { verdict: "yes", reply: "是的（mock 裁判：关键词命中）" }
    : { verdict: "irrelevant", reply: "无法判断（mock 裁判：未配置 GROQ_API_KEY）" };
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
