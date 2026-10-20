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
    author_session_id TEXT REFERENCES sessions(id),
    shared INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT,
    puzzle_id TEXT NOT NULL REFERENCES puzzles(id),
    host_session_id TEXT REFERENCES sessions(id),
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'solved')),
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
ensureColumn(
  "puzzles",
  "author_session_id",
  "ALTER TABLE puzzles ADD COLUMN author_session_id TEXT REFERENCES sessions(id)",
);
ensureColumn("puzzles", "shared", "ALTER TABLE puzzles ADD COLUMN shared INTEGER NOT NULL DEFAULT 1");

// ensureColumn can add new columns, but SQLite can't ALTER a CHECK
// constraint in place — rooms.status predates the 'waiting' value a host-
// gated lifecycle needs. Rebuilds the table in one transaction when that's
// the case. Non-destructive to real room/transcript data (unlike the puzzle
// reseed below, which only ever wipes reference content): every existing
// row survives, with its status and host backfilled from data that already
// implied them — a room with no question/guess yet becomes 'waiting', one
// with questions becomes 'active', and its earliest joiner (if any) becomes
// its host, since nothing recorded an explicit host before this existed.
// SQLite's `ALTER TABLE rooms RENAME TO rooms_old` (below) silently rewrites
// every OTHER table's `REFERENCES rooms(id)` clause to `REFERENCES
// "rooms_old"(id)` too — not just the renamed table's own DDL. This migration
// never re-pointed room_participants/qa_entries back at the new `rooms`
// table afterward, so their schema has carried a dangling reference to
// `rooms_old` ever since `76be42c`, invisible as long as `rooms_old` still
// physically existed on disk. Rebuilds a table in place with its `room_id`
// FK corrected to `rooms(id)`, preserving every row — used for both tables
// before `rooms_old` is ever dropped, so the drop can't strand a live FK.
function repointRoomIdForeignKey(table: "room_participants" | "qa_entries"): void {
  const ddl =
    (
      db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as
        | { sql: string }
        | undefined
    )?.sql ?? "";
  if (!ddl.includes('"rooms_old"')) return;

  db.exec(`ALTER TABLE ${table} RENAME TO ${table}_stale_fk`);
  db.exec(ddl.replace('"rooms_old"', "rooms"));
  const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
    .map((c) => c.name)
    .join(", ");
  db.exec(`INSERT INTO ${table} (${columns}) SELECT ${columns} FROM ${table}_stale_fk`);
  db.exec(`DROP TABLE ${table}_stale_fk`);
}

function ensureRoomsHaveWaitingStatus(): void {
  const ddl =
    (
      db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rooms'")
        .get() as { sql: string } | undefined
    )?.sql ?? "";
  if (ddl.includes("'waiting'")) {
    // A prior boot can crash after this function creates the new `rooms`
    // table but before its own DROP TABLE at the end (this happened for
    // real on /data: a FOREIGN KEY failure elsewhere during startup killed
    // the process mid-migration). On the next boot the check above returns
    // early since `rooms` already has the new schema, so the leftover
    // `rooms_old` — still FOREIGN KEY-ing into `puzzles`, and still what
    // room_participants/qa_entries' own FK secretly points at (see
    // repointRoomIdForeignKey above) — never gets cleaned up and
    // permanently breaks seedPuzzlesIfEmpty()'s `DELETE FROM puzzles`.
    // Fix the dangling FKs first, then clean it up here unconditionally so
    // a crash mid-migration self-heals on the next boot instead of wedging
    // the app forever.
    repointRoomIdForeignKey("room_participants");
    repointRoomIdForeignKey("qa_entries");
    db.exec("DROP TABLE IF EXISTS rooms_old");
    return;
  }

  db.exec("ALTER TABLE rooms RENAME TO rooms_old");
  db.exec(`
    CREATE TABLE rooms (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT,
      puzzle_id TEXT NOT NULL REFERENCES puzzles(id),
      host_session_id TEXT REFERENCES sessions(id),
      status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'solved')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`
    INSERT INTO rooms (id, code, name, puzzle_id, host_session_id, status, created_at)
    SELECT
      ro.id, ro.code, NULL, ro.puzzle_id,
      (SELECT session_id FROM room_participants WHERE room_id = ro.id ORDER BY joined_at LIMIT 1),
      CASE
        WHEN ro.status = 'solved' THEN 'solved'
        WHEN EXISTS (
          SELECT 1 FROM qa_entries q WHERE q.room_id = ro.id AND q.kind IN ('question', 'guess')
        ) THEN 'active'
        ELSE 'waiting'
      END,
      ro.created_at
    FROM rooms_old ro;
  `);
  repointRoomIdForeignKey("room_participants");
  repointRoomIdForeignKey("qa_entries");
  db.exec("DROP TABLE rooms_old");
}
ensureRoomsHaveWaitingStatus();

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
  author_session_id: string | null;
  shared: boolean;
}

export interface LobbyRoom {
  id: string;
  code: string;
  name: string | null;
  title: string;
  host_session_id: string | null;
  status: "waiting" | "active";
}

export interface Room {
  id: string;
  code: string;
  name: string | null;
  puzzle_id: string;
  host_session_id: string | null;
  status: "waiting" | "active" | "solved";
  created_at: string;
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

const PUZZLE_COLUMNS = "id, title, premise, solution, author_session_id, shared";

function rowToPuzzle(row: {
  id: string;
  title: string;
  premise: string;
  solution: string;
  author_session_id: string | null;
  shared: number;
}): Puzzle {
  return { ...row, shared: Boolean(row.shared) };
}

// Only ever picks from shared/built-in puzzles — the same availability rule
// POST /rooms enforces for a client-chosen puzzleId, so a bare "just create
// me a room" request (no explicit puzzle picked) can't land on someone's
// private authored puzzle either.
export function pickRandomPuzzle(): Puzzle {
  const row = db
    .prepare(`SELECT ${PUZZLE_COLUMNS} FROM puzzles WHERE shared = 1 ORDER BY RANDOM() LIMIT 1`)
    .get() as Parameters<typeof rowToPuzzle>[0] | undefined;
  if (!row) throw new Error("no puzzles seeded");
  return rowToPuzzle(row);
}

export function isPuzzleAvailable(puzzleId: string): boolean {
  const row = db.prepare("SELECT shared FROM puzzles WHERE id = ?").get(puzzleId) as
    | { shared: number }
    | undefined;
  return Boolean(row?.shared);
}

export function createAuthoredPuzzle(args: {
  title: string;
  premise: string;
  solution: string;
  authorSessionId: string;
  shared: boolean;
}): Puzzle {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO puzzles (id, title, premise, solution, author_session_id, shared)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, args.title, args.premise, args.solution, args.authorSessionId, args.shared ? 1 : 0);
  return rowToPuzzle(
    db.prepare(`SELECT ${PUZZLE_COLUMNS} FROM puzzles WHERE id = ?`).get(id) as Parameters<
      typeof rowToPuzzle
    >[0],
  );
}

// Never selects `solution` — the list a room-creation picker renders from
// can't leak an answer just by existing, not merely by the UI choosing not
// to show it.
export function listAvailablePuzzles(): {
  id: string;
  title: string;
  premise: string;
  authorLabel: string | null;
  usageCount: number;
}[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.premise, p.author_session_id AS authorSessionId,
              (SELECT COUNT(*) FROM rooms r WHERE r.puzzle_id = p.id) AS usageCount
       FROM puzzles p
       WHERE p.shared = 1
       ORDER BY p.created_at DESC`,
    )
    .all() as {
    id: string;
    title: string;
    premise: string;
    authorSessionId: string | null;
    usageCount: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    premise: r.premise,
    usageCount: r.usageCount,
    authorLabel: r.authorSessionId
      ? (getProfile(r.authorSessionId).nickname ?? "Anonymous author")
      : null,
  }));
}

// A plain profile lookup, not displayLabel(): resolving who hosts a room
// (for a lobby card) shouldn't register that session as a room participant
// the way actually joining one does.
export function hostLabel(sessionId: string | null): string {
  if (!sessionId) return "Unknown host";
  const profile = getProfile(sessionId);
  if (!profile.nickname) return "Anonymous host";
  return profile.avatar ? `${profile.avatar} ${profile.nickname}` : profile.nickname;
}

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

const ROOM_COLUMNS = "id, code, name, puzzle_id, host_session_id, status, created_at";

// Every room starts 'waiting' (the DDL default) — someone has to be the
// host before anyone can start it, so creation and the host assignment
// happen together, never as a separate step.
export function createRoom(puzzleId: string, opts: { name: string | null; hostSessionId: string }): Room {
  const id = randomUUID();
  let code = randomCode();
  // astronomically unlikely to collide, but a room code must stay unique
  while (db.prepare("SELECT 1 FROM rooms WHERE code = ?").get(code)) {
    code = randomCode();
  }
  db.prepare("INSERT INTO rooms (id, code, name, puzzle_id, host_session_id) VALUES (?, ?, ?, ?, ?)").run(
    id,
    code,
    opts.name,
    puzzleId,
    opts.hostSessionId,
  );
  return db.prepare(`SELECT ${ROOM_COLUMNS} FROM rooms WHERE id = ?`).get(id) as unknown as Room;
}

export function startRoom(roomId: string): void {
  db.prepare("UPDATE rooms SET status = 'active' WHERE id = ? AND status = 'waiting'").run(roomId);
}

export function transferHost(roomId: string, toSessionId: string): void {
  db.prepare("UPDATE rooms SET host_session_id = ? WHERE id = ?").run(toSessionId, roomId);
}

export function listActiveRooms(limit = 20): LobbyRoom[] {
  return db
    .prepare(
      `SELECT r.id, r.code, r.name, p.title, r.host_session_id, r.status
       FROM rooms r
       JOIN puzzles p ON p.id = r.puzzle_id
       WHERE r.status IN ('waiting', 'active')
       ORDER BY r.created_at DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as LobbyRoom[];
}

export function getRoomByCode(code: string): Room | undefined {
  return db
    .prepare(`SELECT ${ROOM_COLUMNS} FROM rooms WHERE code = ?`)
    .get(code.toUpperCase()) as Room | undefined;
}

export function countParticipants(roomId: string): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS n FROM room_participants WHERE room_id = ?")
      .get(roomId) as { n: number }
  ).n;
}

// Has this session ever joined this room — the durable fact, not whether it
// currently holds an open SSE connection (listMembers()). Transferring host
// should work for anyone who's actually part of the room, logged in with JS
// off or between page loads, not just whoever happens to be live right now.
export function isParticipant(roomId: string, sessionId: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM room_participants WHERE room_id = ? AND session_id = ?")
      .get(roomId, sessionId),
  );
}

export function getPuzzle(id: string): Puzzle | undefined {
  const row = db.prepare(`SELECT ${PUZZLE_COLUMNS} FROM puzzles WHERE id = ?`).get(id) as
    | Parameters<typeof rowToPuzzle>[0]
    | undefined;
  return row ? rowToPuzzle(row) : undefined;
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
