import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { SEED_PUZZLES } from "./data/puzzles.ts";

// /data is the only thing that survives a restart or redeploy (fly.toml's
// volume); DATA_DIR lets local dev point somewhere else without touching /data.
const DB_PATH = process.env.DATA_DIR ? `${process.env.DATA_DIR}/app.db` : "/data/app.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS puzzles (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    premise TEXT NOT NULL,
    solution TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    puzzle_id TEXT NOT NULL REFERENCES puzzles(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'solved')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS room_participants (
    room_id TEXT NOT NULL REFERENCES rooms(id),
    session_id TEXT NOT NULL REFERENCES sessions(id),
    label TEXT NOT NULL,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (room_id, session_id)
  );

  CREATE TABLE IF NOT EXISTS qa_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL REFERENCES rooms(id),
    session_id TEXT REFERENCES sessions(id),
    kind TEXT NOT NULL CHECK (kind IN ('question', 'guess', 'system')),
    body TEXT NOT NULL,
    verdict TEXT CHECK (verdict IN ('yes', 'no', 'irrelevant', 'correct')),
    label TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS qa_entries_room ON qa_entries(room_id, id);
`);

// Adds a column only if a prior boot (an older image, or /data carried over
// from before a feature existed) hasn't already added it, since re-running
// ADD COLUMN on one that's already there errors on a duplicate column.
function ensureColumn(table: string, column: string, ddl: string): void {
  const existing = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!existing.has(column)) db.exec(ddl);
}
ensureColumn("sessions", "nickname", "ALTER TABLE sessions ADD COLUMN nickname TEXT");
ensureColumn("sessions", "avatar", "ALTER TABLE sessions ADD COLUMN avatar TEXT");
ensureColumn("sessions", "bio", "ALTER TABLE sessions ADD COLUMN bio TEXT");
ensureColumn("puzzles", "title", "ALTER TABLE puzzles ADD COLUMN title TEXT NOT NULL DEFAULT ''");

// Reconciles the seed puzzles against src/data/puzzles.ts on every boot,
// rather than inserting once when the table is empty. An "only if empty"
// seed silently freezes the table at whatever content shipped first — a
// later edit to SEED_PUZZLES (e.g. a translation) would update the code but
// never reach rows already sitting on the /data volume. Puzzle text is
// reference content, not user data, so it's fine to resync it; any room
// still pointing at a stale puzzle id is cleared along with it, since a
// mismatch here only happens when the puzzle bank itself changed underneath
// existing rooms.
function seedPuzzlesIfEmpty(): void {
  const rows = db.prepare("SELECT title, premise, solution FROM puzzles").all() as {
    title: string;
    premise: string;
    solution: string;
  }[];
  const current = new Set(rows.map((r) => `${r.title}\u0000${r.premise}\u0000${r.solution}`));
  const wanted = new Set(
    SEED_PUZZLES.map((p) => `${p.title}\u0000${p.premise}\u0000${p.solution}`),
  );
  const upToDate =
    current.size === wanted.size && [...current].every((entry) => wanted.has(entry));
  if (upToDate) return;

  db.exec(`
    DELETE FROM qa_entries;
    DELETE FROM room_participants;
    DELETE FROM rooms;
    DELETE FROM puzzles;
  `);
  const insert = db.prepare(
    "INSERT INTO puzzles (id, title, premise, solution) VALUES (?, ?, ?, ?)",
  );
  for (const puzzle of SEED_PUZZLES) {
    insert.run(randomUUID(), puzzle.title, puzzle.premise, puzzle.solution);
  }
}
seedPuzzlesIfEmpty();

export interface Puzzle {
  id: string;
  title: string;
  premise: string;
  solution: string;
}

export interface LobbyRoom {
  id: string;
  code: string;
  title: string;
  started: boolean;
}

export interface Room {
  id: string;
  code: string;
  puzzle_id: string;
  status: "active" | "solved";
}

export interface QaEntry {
  id: number;
  room_id: string;
  session_id: string | null;
  kind: "question" | "guess" | "system";
  body: string;
  verdict: "yes" | "no" | "irrelevant" | "correct" | null;
  label: string | null;
  created_at: string;
}

export function pickRandomPuzzle(): Puzzle {
  const row = db
    .prepare("SELECT id, title, premise, solution FROM puzzles ORDER BY RANDOM() LIMIT 1")
    .get() as Puzzle | undefined;
  if (!row) throw new Error("no puzzles seeded");
  return row;
}

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export function createRoom(puzzleId: string): Room {
  const id = randomUUID();
  let code = randomCode();
  // astronomically unlikely to collide, but a room code must stay unique
  while (db.prepare("SELECT 1 FROM rooms WHERE code = ?").get(code)) {
    code = randomCode();
  }
  db.prepare("INSERT INTO rooms (id, code, puzzle_id) VALUES (?, ?, ?)").run(
    id,
    code,
    puzzleId,
  );
  return { id, code, puzzle_id: puzzleId, status: "active" };
}

// "started" is derived, not a stored state: a room with no question or guess
// yet is distinguishable from one mid-investigation without a separate
// ready/host flow — see PROCESS.md for why that's deliberately as far as the
// room-state distinction goes.
export function listActiveRooms(limit = 20): LobbyRoom[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.code, p.title,
              EXISTS(
                SELECT 1 FROM qa_entries q
                WHERE q.room_id = r.id AND q.kind IN ('question', 'guess')
              ) AS started
       FROM rooms r
       JOIN puzzles p ON p.id = r.puzzle_id
       WHERE r.status = 'active'
       ORDER BY r.created_at DESC
       LIMIT ?`,
    )
    .all(limit) as (Omit<LobbyRoom, "started"> & { started: number })[];
  return rows.map((r) => ({ ...r, started: Boolean(r.started) }));
}

export function getRoomByCode(code: string): Room | undefined {
  return db
    .prepare("SELECT id, code, puzzle_id, status FROM rooms WHERE code = ?")
    .get(code.toUpperCase()) as Room | undefined;
}

export function getPuzzle(id: string): Puzzle | undefined {
  return db.prepare("SELECT id, title, premise, solution FROM puzzles WHERE id = ?").get(id) as
    | Puzzle
    | undefined;
}

export function ensureSession(sessionId: string): void {
  db.prepare("INSERT OR IGNORE INTO sessions (id) VALUES (?)").run(sessionId);
}

export function ensureParticipantLabel(roomId: string, sessionId: string): string {
  const existing = db
    .prepare("SELECT label FROM room_participants WHERE room_id = ? AND session_id = ?")
    .get(roomId, sessionId) as { label: string } | undefined;
  if (existing) return existing.label;

  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM room_participants WHERE room_id = ?")
    .get(roomId) as { count: number };
  const label = `Anonymous Detective#${count + 1}`;
  db.prepare(
    "INSERT INTO room_participants (room_id, session_id, label) VALUES (?, ?, ?)",
  ).run(roomId, sessionId, label);
  return label;
}

export interface Profile {
  nickname: string | null;
  avatar: string | null;
  bio: string | null;
}

export function getProfile(sessionId: string): Profile {
  const row = db
    .prepare("SELECT nickname, avatar, bio FROM sessions WHERE id = ?")
    .get(sessionId) as Profile | undefined;
  return row ?? { nickname: null, avatar: null, bio: null };
}

export function setProfile(
  sessionId: string,
  profile: { nickname: string | null; avatar: string | null; bio: string | null },
): void {
  db.prepare("UPDATE sessions SET nickname = ?, avatar = ?, bio = ? WHERE id = ?").run(
    profile.nickname,
    profile.avatar,
    profile.bio,
    sessionId,
  );
}

export function profileStats(sessionId: string): { participated: number; solved: number } {
  const participated = (
    db
      .prepare("SELECT COUNT(DISTINCT room_id) AS n FROM room_participants WHERE session_id = ?")
      .get(sessionId) as { n: number }
  ).n;
  const solved = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT rp.room_id) AS n
         FROM room_participants rp
         JOIN rooms r ON r.id = rp.room_id
         WHERE rp.session_id = ? AND r.status = 'solved'`,
      )
      .get(sessionId) as { n: number }
  ).n;
  return { participated, solved };
}

// What to actually show for a session in a room: a chosen nickname (with its
// avatar baked in as a plain prefix, so every caller that already renders a
// label string — transcript entries, the member list, "you are" — gets the
// avatar for free, with no second field threaded through SSE/rendering).
// Always registers the session as a participant first, even when a nickname
// overrides the displayed text, so participation stats and the auto-label's
// numbering stay accurate regardless of whether a nickname is set.
export function displayLabel(roomId: string, sessionId: string): string {
  const autoLabel = ensureParticipantLabel(roomId, sessionId);
  const profile = getProfile(sessionId);
  const nickname = profile.nickname?.trim();
  if (!nickname) return autoLabel;
  return profile.avatar ? `${profile.avatar} ${nickname}` : nickname;
}

export function getTranscript(roomId: string, afterId = 0): QaEntry[] {
  return db
    .prepare(
      "SELECT id, room_id, session_id, kind, body, verdict, label, created_at FROM qa_entries WHERE room_id = ? AND id > ? ORDER BY id ASC",
    )
    .all(roomId, afterId) as unknown as QaEntry[];
}

export function insertEntry(entry: {
  roomId: string;
  sessionId: string | null;
  kind: QaEntry["kind"];
  body: string;
  verdict: QaEntry["verdict"];
  label: string | null;
}): QaEntry {
  const result = db
    .prepare(
      "INSERT INTO qa_entries (room_id, session_id, kind, body, verdict, label) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(entry.roomId, entry.sessionId, entry.kind, entry.body, entry.verdict, entry.label);
  return db
    .prepare(
      "SELECT id, room_id, session_id, kind, body, verdict, label, created_at FROM qa_entries WHERE id = ?",
    )
    .get(result.lastInsertRowid) as unknown as QaEntry;
}

export function markSolved(roomId: string): void {
  db.prepare("UPDATE rooms SET status = 'solved' WHERE id = ?").run(roomId);
}

export function lastQuestionAt(roomId: string, sessionId: string): string | undefined {
  const row = db
    .prepare(
      "SELECT created_at FROM qa_entries WHERE room_id = ? AND session_id = ? AND kind IN ('question', 'guess') ORDER BY id DESC LIMIT 1",
    )
    .get(roomId, sessionId) as { created_at: string } | undefined;
  return row?.created_at;
}
