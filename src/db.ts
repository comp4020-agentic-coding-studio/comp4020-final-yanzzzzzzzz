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
    slug TEXT,
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

  -- Site-wide counters. A key/value table rather than dedicated columns:
  -- the only two keys today are a running total and an immutable "when did
  -- counting start" marker, and a new counter later is one more row, not a
  -- schema change.
  CREATE TABLE IF NOT EXISTS stats (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- One row per session, never per room: the thing being deduplicated is a
  -- single person's wall-clock time, and a person is a session, not a
  -- (session, room) pair. See recordHeartbeat() for why this is enough to
  -- dedupe overlapping tabs/rooms for the same session without a join.
  CREATE TABLE IF NOT EXISTS session_activity (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id),
    last_heartbeat_at TEXT NOT NULL
  );

  -- Community story reviews. One row per (session, puzzle): a session can
  -- revisit and UPDATE its own review (hence the UNIQUE constraint doubling
  -- as the "edit, don't duplicate" rule), never another session's. Only ever
  -- written for a puzzle that's shared=1 at write time — see routes/community.ts
  -- for the server-side visibility check this table alone can't enforce.
  CREATE TABLE IF NOT EXISTS story_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    puzzle_id TEXT NOT NULL REFERENCES puzzles(id),
    session_id TEXT NOT NULL REFERENCES sessions(id),
    rating INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
    body TEXT NOT NULL,
    spoiler INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (puzzle_id, session_id)
  );

  CREATE INDEX IF NOT EXISTS story_reviews_puzzle ON story_reviews(puzzle_id, created_at DESC);
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
ensureColumn("puzzles", "slug", "ALTER TABLE puzzles ADD COLUMN slug TEXT");

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

// Pre-translation official titles, in SEED_PUZZLES order, from the original
// English build. Only used once, to backfill `slug` onto rows that predate
// the slug column entirely — see reconcileSeedPuzzles() below.
const LEGACY_ENGLISH_TITLES = [
  "A Bowl of Turtle Soup",
  "The Silent Phone Call",
  "The Elevator Routine",
  "The Desert Parachute",
  "The Avoided Gas Station",
  "The Discarded Shoes",
  "The Man and the Straw",
  "The Dinner Party Soup",
];

// Reconciles the OFFICIAL puzzle rows (author_session_id IS NULL — never
// touches a player-authored one) against SEED_PUZZLES by `slug`, a stable id
// that doesn't change when a title/premise/solution is edited or translated.
// Never deletes a row, so a room's `puzzle_id` foreign key can never dangle:
//
//  - a slug already present on a row gets that row's title/premise/solution
//    UPDATEd in place to match the code — this is what lets "rewrite case
//    #3 in Chinese" update the content every room pointing at that puzzle_id
//    already sees, rather than silently creating a duplicate row;
//  - a slug with no matching row (a brand new SEED_PUZZLES entry, or the very
//    first boot of a fresh database) gets INSERTed;
//  - a pre-slug row (every /data volume from before this column existed, a
//    full legacy English title/premise/solution with slug IS NULL) is
//    matched once by its known legacy English title and has its slug
//    backfilled, THEN the same in-place UPDATE above brings its text to the
//    current (Chinese) SEED_PUZZLES content — so an existing volume's rooms
//    keep their puzzle_id and gain the new content, not a second puzzle.
//
// This used to reconcile by wiping qa_entries/room_participants/rooms/
// puzzles entirely whenever the live table didn't exactly equal SEED_PUZZLES
// by set-equality (see PROCESS.md for the real data-loss bug that caused,
// and spec/migration.test.ts for the regression test) — a purely additive/
// in-place-update reconciliation, keyed by slug rather than by exact text
// equality, can't repeat either failure mode: editing or translating an
// entry's text no longer looks like "a different puzzle" at all.
function reconcileSeedPuzzles(): void {
  const legacyRows = db
    .prepare("SELECT id, title FROM puzzles WHERE author_session_id IS NULL AND slug IS NULL")
    .all() as { id: string; title: string }[];
  const legacyTitleToId = new Map(legacyRows.map((r) => [r.title, r.id]));

  const insert = db.prepare(
    "INSERT INTO puzzles (id, slug, title, premise, solution) VALUES (?, ?, ?, ?, ?)",
  );
  const updateBySlug = db.prepare(
    "UPDATE puzzles SET title = ?, premise = ?, solution = ? WHERE slug = ? AND author_session_id IS NULL",
  );
  const backfillSlug = db.prepare("UPDATE puzzles SET slug = ? WHERE id = ?");

  SEED_PUZZLES.forEach((puzzle, i) => {
    const existingBySlug = db
      .prepare("SELECT 1 FROM puzzles WHERE slug = ? AND author_session_id IS NULL")
      .get(puzzle.slug);
    if (existingBySlug) {
      updateBySlug.run(puzzle.title, puzzle.premise, puzzle.solution, puzzle.slug);
      return;
    }

    const legacyId = legacyTitleToId.get(LEGACY_ENGLISH_TITLES[i] ?? "");
    if (legacyId) {
      backfillSlug.run(puzzle.slug, legacyId);
      updateBySlug.run(puzzle.title, puzzle.premise, puzzle.solution, puzzle.slug);
      return;
    }

    insert.run(randomUUID(), puzzle.slug, puzzle.title, puzzle.premise, puzzle.solution);
  });
}
reconcileSeedPuzzles();

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
export function listAvailablePuzzles(search?: string): {
  id: string;
  slug: string | null;
  title: string;
  premise: string;
  authorLabel: string | null;
  usageCount: number;
}[] {
  const like = search ? `%${search.replace(/[%_]/g, (m) => `\\${m}`)}%` : null;
  const rows = (
    like
      ? db.prepare(
          `SELECT p.id, p.slug, p.title, p.premise, p.author_session_id AS authorSessionId,
                  (SELECT COUNT(*) FROM rooms r WHERE r.puzzle_id = p.id) AS usageCount
           FROM puzzles p
           WHERE p.shared = 1 AND (p.title LIKE ? ESCAPE '\\' OR p.premise LIKE ? ESCAPE '\\')
           ORDER BY p.created_at DESC`,
        )
      : db.prepare(
          `SELECT p.id, p.slug, p.title, p.premise, p.author_session_id AS authorSessionId,
                  (SELECT COUNT(*) FROM rooms r WHERE r.puzzle_id = p.id) AS usageCount
           FROM puzzles p
           WHERE p.shared = 1
           ORDER BY p.created_at DESC`,
        )
  ).all(...(like ? [like, like] : [])) as {
    id: string;
    slug: string | null;
    title: string;
    premise: string;
    authorSessionId: string | null;
    usageCount: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
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

// A single room's lobby-card row, same shape and joins as listActiveRooms()
// — used to push a live upsert for one room (on start/transfer-host/solve)
// without re-querying or re-sending the whole lobby list. Returns undefined
// for a solved/missing room, which the caller treats as "remove this card."
export function getLobbyCard(roomId: string): LobbyRoom | undefined {
  return db
    .prepare(
      `SELECT r.id, r.code, r.name, p.title, r.host_session_id, r.status
       FROM rooms r
       JOIN puzzles p ON p.id = r.puzzle_id
       WHERE r.id = ? AND r.status IN ('waiting', 'active')`,
    )
    .get(roomId) as LobbyRoom | undefined;
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

const REASONING_TOTAL_KEY = "reasoning_total_seconds";
const REASONING_STARTED_KEY = "reasoning_tracking_started_at";

// Both rows are created the first time this code runs against a database,
// whichever boot that is — never overwritten afterward (INSERT OR IGNORE),
// so the start marker stays the moment counting actually began, not a value
// backfilled later from room-creation timestamps that predate this feature.
db.exec(
  `INSERT OR IGNORE INTO stats (key, value) VALUES ('${REASONING_TOTAL_KEY}', '0')`,
);
db.exec(
  `INSERT OR IGNORE INTO stats (key, value) VALUES ('${REASONING_STARTED_KEY}', (SELECT datetime('now')))`,
);

export function totalReasoningSeconds(): number {
  const row = db.prepare("SELECT value FROM stats WHERE key = ?").get(REASONING_TOTAL_KEY) as
    | { value: string }
    | undefined;
  return row ? Number(row.value) : 0;
}

export function reasoningTrackingStartedAt(): string {
  const row = db.prepare("SELECT value FROM stats WHERE key = ?").get(REASONING_STARTED_KEY) as
    | { value: string }
    | undefined;
  return row?.value ?? "";
}

// A heartbeat only ever credits the gap since this SESSION's (not this
// room's, not this tab's) last recorded moment, wherever that moment came
// from. Keying the cursor by session_id alone — one row total, no matter how
// many tabs or rooms a person has open — is what dedupes overlapping real
// time across them for free: two tabs pinging the same session just both
// advance the same cursor, so the same stretch of wall-clock time can never
// be credited twice. A missed stretch (background tab, dropped connection, a
// restart) simply isn't there to extend the cursor through, so it's never
// retroactively credited either.
const HEARTBEAT_IDLE_LIMIT_MS = 5 * 60 * 1000;
const HEARTBEAT_MIN_GAP_MS = 3_000;

export interface HeartbeatResult {
  ok: boolean;
  reason?: "not-participant" | "not-active";
  credited: boolean;
}

// `resume` is an event the client asserts (a tab just became visible, or
// just loaded), never a duration — the server's own clock still decides how
// much time that implies, which is "none, this call only sets a fresh
// baseline." Trusting a client's "I just came back to foreground" signal
// can only ever cost it credit it would otherwise have gotten, never grant
// extra, so there's nothing to gain by lying about it.
export function recordHeartbeat(
  roomId: string,
  sessionId: string,
  opts: { resume?: boolean } = {},
): HeartbeatResult {
  if (!isParticipant(roomId, sessionId)) {
    return { ok: false, reason: "not-participant", credited: false };
  }
  const room = db.prepare("SELECT status FROM rooms WHERE id = ?").get(roomId) as
    | { status: string }
    | undefined;
  if (!room || room.status !== "active") {
    return { ok: false, reason: "not-active", credited: false };
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const existing = db
    .prepare("SELECT last_heartbeat_at FROM session_activity WHERE session_id = ?")
    .get(sessionId) as { last_heartbeat_at: string } | undefined;

  if (!existing) {
    db.prepare(
      "INSERT INTO session_activity (session_id, last_heartbeat_at) VALUES (?, ?)",
    ).run(sessionId, nowIso);
    return { ok: true, credited: false };
  }

  const elapsedMs = now - Date.parse(existing.last_heartbeat_at);

  if (!opts.resume && elapsedMs < HEARTBEAT_MIN_GAP_MS) {
    // A near-duplicate call (retry, double-fired timer) carries too little
    // new wall-clock time to matter — skip the write rather than churn the
    // database for noise.
    return { ok: true, credited: false };
  }

  db.prepare("UPDATE session_activity SET last_heartbeat_at = ? WHERE session_id = ?").run(
    nowIso,
    sessionId,
  );

  if (opts.resume || elapsedMs >= HEARTBEAT_IDLE_LIMIT_MS) {
    // Either the client just told us this is a fresh foreground start (so
    // whatever came before it is deliberately not this call's to credit), or
    // the gap is long enough that it can only be a background tab, a
    // dropped connection, or a sleeping machine — either way, nothing earns
    // credit, the cursor just moves to now.
    return { ok: true, credited: false };
  }

  const seconds = Math.round(elapsedMs / 1000);
  if (seconds > 0) {
    db.prepare(`UPDATE stats SET value = CAST(value AS INTEGER) + ? WHERE key = ?`).run(
      seconds,
      REASONING_TOTAL_KEY,
    );
  }
  return { ok: true, credited: seconds > 0 };
}

export function lastQuestionAt(roomId: string, sessionId: string): string | undefined {
  const row = db
    .prepare(
      "SELECT created_at FROM qa_entries WHERE room_id = ? AND session_id = ? AND kind IN ('question', 'guess') ORDER BY id DESC LIMIT 1",
    )
    .get(roomId, sessionId) as { created_at: string } | undefined;
  return row?.created_at;
}

// --- Community story reviews ---------------------------------------------

export interface StoryReview {
  id: number;
  puzzleId: string;
  puzzleTitle: string;
  sessionId: string;
  reviewerLabel: string;
  reviewerAvatar: string | null;
  rating: number | null;
  body: string;
  spoiler: boolean;
  createdAt: string;
  updatedAt: string;
}

// A plain profile lookup (same shape as hostLabel()): a review's byline is
// "whoever this session publicly is," not a room-scoped participant label —
// reviews aren't tied to any room, so there's no "Anonymous Detective#N" to
// fall back to, only a nickname or a generic "Anonymous reviewer."
function reviewerLabel(sessionId: string): { label: string; avatar: string | null } {
  const profile = getProfile(sessionId);
  return { label: profile.nickname ?? "Anonymous reviewer", avatar: profile.avatar };
}

function rowToStoryReview(row: {
  id: number;
  puzzle_id: string;
  puzzle_title: string;
  session_id: string;
  rating: number | null;
  body: string;
  spoiler: number;
  created_at: string;
  updated_at: string;
}): StoryReview {
  const { label, avatar } = reviewerLabel(row.session_id);
  return {
    id: row.id,
    puzzleId: row.puzzle_id,
    puzzleTitle: row.puzzle_title,
    sessionId: row.session_id,
    reviewerLabel: label,
    reviewerAvatar: avatar,
    rating: row.rating,
    body: row.body,
    spoiler: Boolean(row.spoiler),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const STORY_REVIEW_COLUMNS =
  "sr.id, sr.puzzle_id, p.title AS puzzle_title, sr.session_id, sr.rating, sr.body, sr.spoiler, sr.created_at, sr.updated_at";

// Only ever reads a review whose puzzle is CURRENTLY shared=1 — a puzzle
// that's never had its visibility flipped off today, but the join guards
// against that existing surface ever silently leaking a review for a since-
// privatized story, same spirit as listAvailablePuzzles()'s own join.
export function listReviews(puzzleId?: string): StoryReview[] {
  const rows = (
    puzzleId
      ? db
          .prepare(
            `SELECT ${STORY_REVIEW_COLUMNS} FROM story_reviews sr
             JOIN puzzles p ON p.id = sr.puzzle_id AND p.shared = 1
             WHERE sr.puzzle_id = ?
             ORDER BY sr.created_at DESC`,
          )
          .all(puzzleId)
      : db
          .prepare(
            `SELECT ${STORY_REVIEW_COLUMNS} FROM story_reviews sr
             JOIN puzzles p ON p.id = sr.puzzle_id AND p.shared = 1
             ORDER BY sr.created_at DESC`,
          )
          .all()
  ) as Parameters<typeof rowToStoryReview>[0][];
  return rows.map(rowToStoryReview);
}

export function getOwnReview(puzzleId: string, sessionId: string): StoryReview | undefined {
  const row = db
    .prepare(
      `SELECT ${STORY_REVIEW_COLUMNS} FROM story_reviews sr
       JOIN puzzles p ON p.id = sr.puzzle_id
       WHERE sr.puzzle_id = ? AND sr.session_id = ?`,
    )
    .get(puzzleId, sessionId) as Parameters<typeof rowToStoryReview>[0] | undefined;
  return row ? rowToStoryReview(row) : undefined;
}

// A session's own most recent review write, across every puzzle — the
// posting-cooldown clock. Deliberately not scoped to one puzzle: the per-
// (puzzle, session) UNIQUE constraint already stops duplicate rows for the
// same story, so the thing a cooldown actually has to slow down is rapid
// posting/editing across different stories.
export function lastReviewWriteAt(sessionId: string): string | undefined {
  const row = db
    .prepare("SELECT updated_at FROM story_reviews WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1")
    .get(sessionId) as { updated_at: string } | undefined;
  return row?.updated_at;
}

// INSERT-or-UPDATE keyed by the table's own (puzzle_id, session_id) UNIQUE
// constraint: a session reviewing a puzzle it already reviewed updates that
// one row in place rather than ever creating a second — this is the whole
// mechanism behind "one review per session per story, author can edit,
// nobody else can."
export function upsertReview(args: {
  puzzleId: string;
  sessionId: string;
  rating: number | null;
  body: string;
  spoiler: boolean;
}): void {
  db.prepare(
    `INSERT INTO story_reviews (puzzle_id, session_id, rating, body, spoiler, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (puzzle_id, session_id) DO UPDATE SET
       rating = excluded.rating,
       body = excluded.body,
       spoiler = excluded.spoiler,
       updated_at = datetime('now')`,
  ).run(args.puzzleId, args.sessionId, args.rating, args.body, args.spoiler ? 1 : 0);
}
