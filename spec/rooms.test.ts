import { expect, inject, it } from "vitest";
import { SEED_PUZZLES } from "../src/data/puzzles.ts";

// CI never sets GROQ_API_KEY (the course's own LLM proxy key is
// ANU-network-restricted and unreachable from a Fly machine or a GitHub
// runner — see PROCESS.md), so src/llm.ts always falls back to its
// deterministic mock judge here. These checks exercise the app's own
// plumbing (room creation, multi-user distinction, the live transcript),
// not the real AI's judgement — that's a person's call at a crit, not a
// spec's.
const baseUrl = inject("baseUrl");

function parseCookie(setCookieHeaders: string[]): string {
  const sessionCookie = setCookieHeaders.find((h) => h.startsWith("turtle_session="));
  if (!sessionCookie) throw new Error("no turtle_session cookie set");
  return sessionCookie.split(";")[0];
}

// Only creates the room — does NOT visit the room page, since that itself
// would register an anonymous participant and shift every caller's
// first-visitor numbering by one.
async function createRoom(): Promise<{ code: string }> {
  const res = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    redirect: "manual",
  });
  expect(res.status).toBe(303);
  const location = res.headers.get("location") ?? "";
  const code = location.split("/").pop() ?? "";
  expect(code).toMatch(/^[A-Z0-9]{5}$/);
  return { code };
}

// Visits a room page as a brand-new anonymous session (no cookie passed in)
// and returns the session cookie it was issued, plus the rendered HTML.
async function visitRoom(code: string): Promise<{ cookie: string; html: string }> {
  const res = await fetch(new URL(`/rooms/${code}`, baseUrl), { redirect: "manual" });
  const cookie = parseCookie(res.headers.getSetCookie());
  const html = await res.text();
  return { cookie, html };
}

it("creates a room and serves its page", async () => {
  const { code } = await createRoom();
  const { html } = await visitRoom(code);
  expect(html).toContain(code);
});

it("distinguishes multiple anonymous sessions in the same room", async () => {
  const { code } = await createRoom();

  const { cookie: cookieA, html: htmlA } = await visitRoom(code);
  expect(htmlA).toContain("Anonymous Detective#1");

  // A request with no cookie at all is a second, distinct anonymous session.
  const { cookie: cookieB, html: htmlB } = await visitRoom(code);
  expect(htmlB).toContain("Anonymous Detective#2");

  expect(cookieA).not.toBe(cookieB);
});

it("broadcasts an asked question to the room's live transcript", async () => {
  const { code } = await createRoom();
  const { cookie } = await visitRoom(code);

  const ask = await fetch(new URL(`/rooms/${code}/ask`, baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ question: "this is a test question" }),
    redirect: "manual",
  });
  expect(ask.status).toBe(303);

  const after = await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie } });
  const html = await after.text();
  expect(html).toContain("this is a test question");
});

it("lists a newly created room on the homepage so others can join it", async () => {
  const { code } = await createRoom();
  const res = await fetch(new URL("/", baseUrl));
  const html = await res.text();
  expect(html).toContain(`/rooms/${code}`);
});

it("never leaks a puzzle's solution to the client while the room is active", async () => {
  const { code } = await createRoom();
  const { html } = await visitRoom(code);
  expect(html).not.toMatch(/data-solved="true"/);
  for (const puzzle of SEED_PUZZLES) {
    expect(html, `room page leaked a solution: "${puzzle.solution}"`).not.toContain(
      puzzle.solution,
    );
  }
});
