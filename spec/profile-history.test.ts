import { expect, inject, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// HTTP-level coverage for the profile page's new "Your investigations" /
// "Your stories" sections (src/routes/profile.ts, src/render/profile.ts,
// src/db.ts's listOwnInvestigations/listOwnStories) and the Case Library's
// viewer-aware isMine/"Yours" filter (src/db.ts's listAvailablePuzzles).
const baseUrl = inject("baseUrl");

function parseCookie(setCookieHeaders: string[]): string {
  const sessionCookie = setCookieHeaders.find((h) => h.startsWith("turtle_session="));
  if (!sessionCookie) throw new Error("no turtle_session cookie set");
  return sessionCookie.split(";")[0];
}

async function freshSession(): Promise<string> {
  const res = await fetch(new URL("/", baseUrl), { redirect: "manual" });
  return parseCookie(res.headers.getSetCookie());
}

async function createRoom(cookie: string): Promise<string> {
  const res = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { cookie },
    redirect: "manual",
  });
  const code = (res.headers.get("location") ?? "").split("/").pop() ?? "";
  return code;
}

async function startRoom(code: string, hostCookie: string): Promise<void> {
  // Creating a room does not itself make the host a room_participant — only
  // visiting GET /rooms/:code does (src/routes/rooms.ts's join-on-view
  // logic, which intentionally stays as the one place that registers a
  // participant). Any test that later expects the host to show up in
  // participated history or accrue heartbeat credit must visit the room
  // with the SAME cookie first, exactly as a real host's browser would.
  await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie: hostCookie } });
  await fetch(new URL(`/rooms/${code}/start`, baseUrl), {
    method: "POST",
    headers: { cookie: hostCookie },
    redirect: "manual",
  });
}

async function joinRoom(code: string, cookie: string): Promise<void> {
  await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie } });
}

async function createAuthoredPuzzle(
  cookie: string,
  opts: { title: string; shared: boolean },
): Promise<string> {
  const res = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      mode: "author",
      title: opts.title,
      premise: "A premise for testing.",
      solution: "A specific unmistakable solution phrase.",
      ...(opts.shared ? { shared: "on" } : {}),
    }),
    redirect: "manual",
  });
  return (res.headers.get("location") ?? "").split("/").pop() ?? "";
}

// ---------- A) own investigation history, session-scoped --------------

it("two independent sessions each see only their own investigation history", async () => {
  const cookieA = await freshSession();
  const codeA = await createRoom(cookieA);
  await startRoom(codeA, cookieA);

  const cookieB = await freshSession();
  const codeB = await createRoom(cookieB);
  await startRoom(codeB, cookieB);
  // B also joins A's room, so A's history must still never mention B's own
  // room, and B's history must never mention a room scoped to A's session.
  await joinRoom(codeA, cookieB);

  const profileA = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie: cookieA } })).text();
  const profileB = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie: cookieB } })).text();

  expect(profileA).toContain(`/rooms/${codeA}`);
  expect(profileA).not.toContain(`/rooms/${codeB}`);

  expect(profileB).toContain(`/rooms/${codeA}`);
  expect(profileB).toContain(`/rooms/${codeB}`);
});

it("never reads the session from a query param, only from the cookie", async () => {
  const cookieA = await freshSession();
  const codeA = await createRoom(cookieA);
  await startRoom(codeA, cookieA);

  const cookieB = await freshSession();

  // B tries to view A's history by passing A's own cookie value as a bogus
  // query param while authenticating as itself — must have zero effect.
  const res = await fetch(new URL(`/profile?session=${encodeURIComponent(cookieA)}`, baseUrl), {
    headers: { cookie: cookieB },
  });
  const html = await res.text();
  expect(html).not.toContain(`/rooms/${codeA}`);
});

it("solving a room shows 'Solved together' for every participant, not a personal solve claim", async () => {
  const cookieHost = await freshSession();
  const codeRes = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { cookie: cookieHost, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      mode: "author",
      title: "Solved Together Case",
      premise: "A premise for testing.",
      solution: "A specific unmistakable solution phrase.",
    }),
    redirect: "manual",
  });
  const code = (codeRes.headers.get("location") ?? "").split("/").pop() ?? "";
  await startRoom(code, cookieHost);

  // A second session joins and submits the winning guess — not the author
  // (an author's own guess is rejected, see spec/room-lifecycle.test.ts).
  const cookieGuesser = await freshSession();
  await joinRoom(code, cookieGuesser);
  await fetch(new URL(`/rooms/${code}/ask`, baseUrl), {
    method: "POST",
    headers: { cookie: cookieGuesser, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ question: "unmistakable solution phrase", kind: "guess" }),
    redirect: "manual",
  });

  const hostProfile = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie: cookieHost } })).text();
  expect(hostProfile).toContain("Solved together");
  // Never claims the host personally solved it, nor a generic "You solved" string.
  expect(hostProfile).not.toContain("You solved");
});

it("a host-ended room shows 'Ended unsolved' in its history, never a solved credit", async () => {
  const cookieHost = await freshSession();
  const code = await createRoom(cookieHost);
  await startRoom(code, cookieHost);

  const end = await fetch(new URL(`/rooms/${code}/end`, baseUrl), {
    method: "POST",
    headers: { cookie: cookieHost, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ confirm: "end" }),
    redirect: "manual",
  });
  expect(end.status).toBe(303);

  const profile = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie: cookieHost } })).text();
  expect(profile).toContain("Ended unsolved");
  expect(profile).not.toContain("Solved together");
});

it("an old/untracked participation shows 'Not recorded' time, truthfully, never a fabricated duration", async () => {
  const cookie = await freshSession();
  const code = await createRoom(cookie);
  await joinRoom(code, cookie);
  // Room created and joined but the room was never started, so no heartbeat
  // was ever possible — reasoning_seconds for this (room, session) stays
  // NULL, exactly like every pre-feature historical row would.
  const profile = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie } })).text();
  expect(profile).toContain("Not recorded");
});

it("profile history is bounded to 20 rows per page with working pagination and an empty state", async () => {
  const cookie = await freshSession();
  for (let i = 0; i < 25; i++) {
    const code = await createRoom(cookie);
    await startRoom(code, cookie);
  }
  const page1 = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie } })).text();
  const rowsPage1 = (page1.match(/class="profile-history-row"/g) ?? []).length;
  // Two sections share the row class; bound the count check to the
  // investigations section specifically.
  const investigationsSection = page1.split('id="your-investigations"')[1]?.split("</section>")[0] ?? "";
  const storiesSection = page1.split('id="your-stories"')[1]?.split("</section>")[0] ?? "";
  const investigationRows = (investigationsSection.match(/class="profile-history-row"/g) ?? []).length;
  expect(investigationRows).toBeLessThanOrEqual(20);
  expect(page1).toContain("historyPage=2");
  void rowsPage1;
  void storiesSection;

  const page2 = await (await fetch(new URL("/profile?historyPage=2", baseUrl), { headers: { cookie } })).text();
  expect(page2).toContain("Page 2 of");

  const freshCookie = await freshSession();
  const emptyProfile = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie: freshCookie } })).text();
  expect(emptyProfile).toContain("You haven't joined any cases yet.");
  expect(emptyProfile).toContain("You haven't written any cases yet.");
});

it("an absurdly large historyPage falls back to page 1 instead of an unsafe OFFSET, and a valid page still works", async () => {
  const cookie = await freshSession();
  const code = await createRoom(cookie);
  await startRoom(code, cookie);

  const huge = await fetch(new URL(`/profile?historyPage=1e20`, baseUrl), { headers: { cookie } });
  expect(huge.status).toBe(200);
  const hugeHtml = await huge.text();
  expect(hugeHtml).toContain(`/rooms/${code}`);

  const valid = await fetch(new URL(`/profile?historyPage=1`, baseUrl), { headers: { cookie } });
  expect(valid.status).toBe(200);
  expect(await valid.text()).toContain(`/rooms/${code}`);
});

// ---------- C/D) own stories, visibility, and no solution leak ----------

it("a shared story shows the 'Uploaded by you' badge only to its own author, never to another viewer", async () => {
  const author = await freshSession();
  const code = await createAuthoredPuzzle(author, { title: "Shared Badge Case", shared: true });
  expect(code).toBeTruthy();

  const authorProfile = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie: author } })).text();
  expect(authorProfile).toContain("Shared Badge Case");
  expect(authorProfile).toContain("Uploaded by you");

  const stranger = await freshSession();
  const library = await (await fetch(new URL("/cases", baseUrl), { headers: { cookie: stranger } })).text();
  expect(library).toContain("Shared Badge Case");
  // The library card is shown (it's shared), but the badge must not render
  // on the stranger's view of the same card.
  const cardSection = library.split("Shared Badge Case")[0].split("<li class=\"case-browse-card\">").pop() ?? "";
  expect(`${cardSection}${library.split("Shared Badge Case")[1]?.slice(0, 400) ?? ""}`).not.toContain(
    "Uploaded by you",
  );
});

it("a private story is visible only on its own author's profile and Yours filter, never in a stranger's library or Yours filter", async () => {
  const author = await freshSession();
  const code = await createAuthoredPuzzle(author, { title: "Private Eyes Only Case", shared: false });
  expect(code).toBeTruthy();

  const authorProfile = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie: author } })).text();
  expect(authorProfile).toContain("Private Eyes Only Case");
  expect(authorProfile).toContain("Private");

  const authorYours = await (
    await fetch(new URL("/cases?source=mine", baseUrl), { headers: { cookie: author } })
  ).text();
  expect(authorYours).toContain("Private Eyes Only Case");

  const stranger = await freshSession();
  const strangerLibrary = await (await fetch(new URL("/cases", baseUrl), { headers: { cookie: stranger } })).text();
  expect(strangerLibrary).not.toContain("Private Eyes Only Case");

  const strangerYours = await (
    await fetch(new URL("/cases?source=mine", baseUrl), { headers: { cookie: stranger } })
  ).text();
  expect(strangerYours).not.toContain("Private Eyes Only Case");
});

it("never leaks a solution's HTML into the profile's own-stories list or the case library", async () => {
  const author = await freshSession();
  await createAuthoredPuzzle(author, { title: "No Solution Leak Case", shared: true });

  const profile = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie: author } })).text();
  expect(profile).not.toContain("A specific unmistakable solution phrase.");

  const library = await (await fetch(new URL("/cases", baseUrl), { headers: { cookie: author } })).text();
  expect(library).not.toContain("A specific unmistakable solution phrase.");
});

// ---------- B) real credited time, dedup, no credit after close --------

it("real heartbeats credit the same (room, session) reasoning_seconds the global dedup counter credits, and a closed room earns no further credit", async () => {
  const cookie = await freshSession();
  const code = await createRoom(cookie);
  await startRoom(code, cookie);

  // A successful heartbeat returns JSON; rejected nonparticipants get an
  // empty 403. The host explicitly joined above before this assertion.
  const first = await fetch(new URL(`/rooms/${code}/heartbeat`, baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(),
  });
  expect(first.status).toBe(200);
  expect((await first.json()).credited).toBe(false);

  await new Promise((r) => setTimeout(r, 3100));

  const second = await fetch(new URL(`/rooms/${code}/heartbeat`, baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(),
  });
  expect(second.status).toBe(200);
  expect((await second.json()).credited).toBe(true);

  const profile = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie } })).text();
  // A real credited duration now appears instead of "Not recorded" for this room.
  const investigationsSection = profile.split('id="your-investigations"')[1]?.split("</section>")[0] ?? "";
  expect(investigationsSection).toContain(`/rooms/${code}`);
  expect(investigationsSection).not.toMatch(new RegExp(`/rooms/${code}"[^]*?Not recorded`));

  // End the room, then heartbeat again — no further credit should land.
  await fetch(new URL(`/rooms/${code}/end`, baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ confirm: "end" }),
    redirect: "manual",
  });
  const afterClose = await fetch(new URL(`/rooms/${code}/heartbeat`, baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(),
  });
  expect(afterClose.status).toBe(403);
});

// ---------- additive migration: reasoning_seconds column -----------------

// Isolated DB/process (its own mkdtemp dir, its own vi.resetModules() +
// cache-busted import), same pattern as spec/migration.test.ts and
// spec/room-watson-dedup.test.ts — never the shared /data volume the live
// server from spec/global-setup.ts already owns, so this never collides with
// that already-opened, cached DatabaseSync handle.
it("adds room_participants.reasoning_seconds additively, leaving every existing row's columns and data untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turtle-soup-reasoning-seconds-test-"));
  process.env.DATA_DIR = dir;

  const seedDb = new DatabaseSync(`${dir}/app.db`);
  seedDb.exec("PRAGMA foreign_keys = ON;");
  seedDb.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      nickname TEXT, avatar TEXT, bio TEXT, avatar_image TEXT
    );
    CREATE TABLE puzzles (
      id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', premise TEXT NOT NULL,
      solution TEXT NOT NULL, author_session_id TEXT REFERENCES sessions(id),
      shared INTEGER NOT NULL DEFAULT 1, slug TEXT, cover_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE rooms (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT,
      puzzle_id TEXT NOT NULL REFERENCES puzzles(id), host_session_id TEXT REFERENCES sessions(id),
      status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'solved')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), closed_at TEXT
    );
    CREATE TABLE room_participants (
      room_id TEXT NOT NULL REFERENCES rooms(id), session_id TEXT NOT NULL REFERENCES sessions(id),
      label TEXT NOT NULL, joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (room_id, session_id)
    );
    CREATE TABLE qa_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL REFERENCES rooms(id),
      session_id TEXT REFERENCES sessions(id),
      kind TEXT NOT NULL CHECK (kind IN ('question', 'guess', 'system')),
      body TEXT NOT NULL, verdict TEXT CHECK (verdict IN ('yes', 'no', 'irrelevant', 'correct')),
      label TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  seedDb.prepare("INSERT INTO sessions (id) VALUES (?)").run("sess-old-1");
  seedDb
    .prepare("INSERT INTO puzzles (id, title, premise, solution, slug) VALUES (?, ?, ?, ?, ?)")
    .run("puzzle-old-1", "Old Case", "An old premise.", "An old solution.", "old-case");
  seedDb
    .prepare("INSERT INTO rooms (id, code, puzzle_id, host_session_id, status) VALUES (?, ?, ?, ?, ?)")
    .run("room-old-1", "OLDXX", "puzzle-old-1", "sess-old-1", "solved");
  seedDb
    .prepare("INSERT INTO room_participants (room_id, session_id, label, joined_at) VALUES (?, ?, ?, ?)")
    .run("room-old-1", "sess-old-1", "Mystery Detective #1", "2020-01-01 00:00:00");
  seedDb.close();

  try {
    vi.resetModules();
    const modulePath = "../src/db.ts?t=" + Date.now();
    const db = await import(/* @vite-ignore */ modulePath);

    const columns = (db.db.prepare("PRAGMA table_info(room_participants)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(columns).toContain("reasoning_seconds");

    const row = db.db
      .prepare("SELECT room_id, session_id, label, joined_at, reasoning_seconds FROM room_participants")
      .get() as { room_id: string; session_id: string; label: string; joined_at: string; reasoning_seconds: number | null };
    expect(row.room_id).toBe("room-old-1");
    expect(row.session_id).toBe("sess-old-1");
    expect(row.label).toBe("Mystery Detective #1");
    expect(row.joined_at).toBe("2020-01-01 00:00:00");
    // Never backfilled from joined_at/created_at — a pre-existing row stays
    // NULL ("not recorded"), not some derived non-null duration.
    expect(row.reasoning_seconds).toBeNull();
  } finally {
    delete process.env.DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});


it("lets an author replay their private story while refusing a different session", async () => {
  const author = await freshSession();
  const stranger = await freshSession();
  await createAuthoredPuzzle(author, { title: "Private replay ownership", shared: false });
  const profile = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie: author } })).text();
  const puzzleId = profile.match(/href="\/rooms\/new\?puzzleId=([0-9a-f-]+)"/)?.[1];
  expect(puzzleId).toBeTruthy();
  const ownerPicker = await (await fetch(new URL(`/rooms/new?puzzleId=${puzzleId}`, baseUrl), { headers: { cookie: author } })).text();
  expect(ownerPicker).toContain(`value="${puzzleId}" selected`);
  const strangerPicker = await (await fetch(new URL(`/rooms/new?puzzleId=${puzzleId}`, baseUrl), { headers: { cookie: stranger } })).text();
  expect(strangerPicker).not.toContain("Private replay ownership");
  for (const [cookie, allowed] of [[author, true], [stranger, false]] as const) {
    const result = await fetch(new URL("/rooms", baseUrl), {
      method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ mode: "existing", puzzleId: puzzleId! }), redirect: "manual",
    });
    expect(result.status).toBe(303);
    const location = result.headers.get("location") ?? "";
    if (allowed) {
      expect(location).toMatch(/^\/rooms\/[A-Z0-9]+$/);
      const room = await (await fetch(new URL(location, baseUrl), { headers: { cookie } })).text();
      expect(room).toContain("Private replay ownership");
    } else expect(location).toContain("unavailable-puzzle");
  }
});
