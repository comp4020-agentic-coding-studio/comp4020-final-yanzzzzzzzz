import { expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Regression test for a real data-loss bug found while verifying this
// session's migration work against a fixture built from the OLD (pre-this-
// session) db.ts's exact schema: seedPuzzlesIfEmpty() reconciled the
// `puzzles` table against SEED_PUZZLES by set-equality, and wiped
// qa_entries/room_participants/rooms/puzzles ENTIRELY whenever that
// equality didn't hold — which happens the moment a single player-authored
// puzzle exists, since that changes the table's row set regardless of
// whether any seed puzzle's text changed. Every real room, transcript
// entry, and participant in the whole app was deleted on the very next
// boot. Confirmed by migrating a hand-built fixture seeded with real-looking
// rooms/participants/qa_entries through the unmodified old code and
// watching it come back empty, before writing the fix.
//
// Doesn't go through spec/global-setup.ts's live server (this app's
// DATA_DIR is fixed for the whole test run) — instead builds a throwaway
// SQLite file with the exact OLD schema+data shape, points a fresh DATA_DIR
// at it, and imports src/db.ts fresh against it, since the migration logic
// runs once at module-import time.
it("keeps every existing room, participant, transcript entry, and authored puzzle when migrating an old-schema database forward", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turtle-soup-migration-test-"));
  process.env.DATA_DIR = dir;

  const seedDb = new DatabaseSync(`${dir}/app.db`);
  seedDb.exec("PRAGMA foreign_keys = ON;");
  seedDb.exec(`
    CREATE TABLE puzzles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      premise TEXT NOT NULL,
      solution TEXT NOT NULL,
      author_session_id TEXT REFERENCES sessions(id),
      shared INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      nickname TEXT,
      avatar TEXT,
      bio TEXT
    );
    CREATE TABLE rooms (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT,
      puzzle_id TEXT NOT NULL REFERENCES puzzles(id),
      host_session_id TEXT REFERENCES sessions(id),
      status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'solved')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE room_participants (
      room_id TEXT NOT NULL REFERENCES rooms(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      label TEXT NOT NULL,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (room_id, session_id)
    );
    CREATE TABLE qa_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL REFERENCES rooms(id),
      session_id TEXT REFERENCES sessions(id),
      kind TEXT NOT NULL CHECK (kind IN ('question', 'guess', 'system')),
      body TEXT NOT NULL,
      verdict TEXT CHECK (verdict IN ('yes', 'no', 'irrelevant', 'correct')),
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  seedDb.prepare("INSERT INTO sessions (id, nickname, avatar, bio) VALUES (?, ?, ?, ?)").run(
    "sess-real-1",
    "Riko",
    "🐢",
    "likes soup",
  );
  seedDb.prepare("INSERT INTO sessions (id) VALUES (?)").run("sess-real-2");
  // The condition that triggered the bug: a puzzle NOT in SEED_PUZZLES,
  // breaking the old code's set-equality check on every future boot.
  seedDb
    .prepare("INSERT INTO puzzles (id, title, premise, solution, author_session_id) VALUES (?, ?, ?, ?, ?)")
    .run("puzzle-real-1", "A Real Authored Case", "A real premise.", "A real solution.", "sess-real-1");
  seedDb
    .prepare(
      "INSERT INTO rooms (id, code, name, puzzle_id, host_session_id, status) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run("room-real-1", "REALX", "Friday squad", "puzzle-real-1", "sess-real-1", "active");
  seedDb
    .prepare("INSERT INTO room_participants (room_id, session_id, label) VALUES (?, ?, ?)")
    .run("room-real-1", "sess-real-1", "🐢 Riko");
  seedDb
    .prepare("INSERT INTO room_participants (room_id, session_id, label) VALUES (?, ?, ?)")
    .run("room-real-1", "sess-real-2", "匿名侦探#2");
  seedDb
    .prepare(
      "INSERT INTO qa_entries (room_id, session_id, kind, body, verdict, label) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run("room-real-1", "sess-real-1", "question", "is it a person", "irrelevant", "🐢 Riko");
  seedDb.close();

  try {
    // A plain `import("../src/db.ts")` would return the copy already cached
    // from any earlier test in this same worker (module-level migration
    // code only runs once per process) — the query string forces a fresh
    // module instance so this test's DATA_DIR is the one it actually runs
    // its migration against. Vite's import analysis needs the specifier's
    // static part literal, so the dynamic suffix is appended outside it.
    const modulePath = "../src/db.ts?t=" + Date.now();
    const db = await import(/* @vite-ignore */ modulePath);

    const rooms = db.db.prepare("SELECT * FROM rooms").all() as { code: string; name: string }[];
    expect(rooms).toHaveLength(1);
    expect(rooms[0].code).toBe("REALX");
    expect(rooms[0].name).toBe("Friday squad");

    const participants = db.db.prepare("SELECT * FROM room_participants").all() as {
      label: string;
    }[];
    expect(participants.map((p) => p.label).sort()).toEqual([
      "匿名侦探#2",
      "🐢 Riko",
    ]);

    const entries = db.db.prepare("SELECT body FROM qa_entries").all() as { body: string }[];
    expect(entries).toEqual([{ body: "is it a person" }]);

    const authoredPuzzle = db.db
      .prepare("SELECT title FROM puzzles WHERE author_session_id = ?")
      .get("sess-real-1") as { title: string } | undefined;
    expect(authoredPuzzle?.title).toBe("A Real Authored Case");

    const profile = db.getProfile("sess-real-1");
    expect(profile.nickname).toBe("Riko");
    expect(profile.avatar).toBe("🐢");

    // The official seed bank is still fully present alongside the real
    // authored puzzle (additive reconciliation, not a reconcile-by-wipe).
    const officialCount = (
      db.db.prepare("SELECT COUNT(*) AS n FROM puzzles WHERE author_session_id IS NULL").get() as {
        n: number;
      }
    ).n;
    expect(officialCount).toBe(8);
  } finally {
    delete process.env.DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});
