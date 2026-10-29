import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { SEED_PUZZLES } from "./data/puzzles.ts";
import { isLegacyEmojiAvatar } from "./avatar-options.ts";

// /data is the only thing that survives a restart or redeploy (fly.toml's
// volume); DATA_DIR lets local dev point somewhere else without touching /data.
// Exported so src/uploads.ts can store cover images on the same durable
// volume, in a directory next to the database rather than a second
// independently-configured path.
export const DATA_DIR = process.env.DATA_DIR ?? "/data";
const DB_PATH = `${DATA_DIR}/app.db`;
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
// NULL means "no uploaded avatar" — every existing row (every session from
// before this column existed) keeps working unchanged through the existing
// emoji-preset/default-art fallback (src/render/avatars.ts); this column
// only ever adds a higher-priority option ahead of the existing `avatar`
// (emoji/preset) column, never replaces it. Stores a server-generated
// filename under the uploads directory (src/uploads.ts), same pattern as
// puzzles.cover_path below — never a user-controlled filename.
ensureColumn("sessions", "avatar_image", "ALTER TABLE sessions ADD COLUMN avatar_image TEXT");
ensureColumn("puzzles", "title", "ALTER TABLE puzzles ADD COLUMN title TEXT NOT NULL DEFAULT ''");
ensureColumn(
  "puzzles",
  "author_session_id",
  "ALTER TABLE puzzles ADD COLUMN author_session_id TEXT REFERENCES sessions(id)",
);
ensureColumn("puzzles", "shared", "ALTER TABLE puzzles ADD COLUMN shared INTEGER NOT NULL DEFAULT 1");
ensureColumn("puzzles", "slug", "ALTER TABLE puzzles ADD COLUMN slug TEXT");
// NULL means "no custom cover" — every existing row (every built-in puzzle,
// every authored puzzle created before this column existed) keeps working
// unchanged through covers.ts's existing stable-cover/archive-cover
// fallback; this column only ever adds a third, higher-priority option.
// Stores a server-generated filename under the uploads directory
// (src/uploads.ts), set once at puzzle-creation time alongside the rest of
// the row — never a user-controlled filename, and never updated afterward
// (no route lets a player edit an existing case's cover).
ensureColumn("puzzles", "cover_path", "ALTER TABLE puzzles ADD COLUMN cover_path TEXT");

// Additive, nullable: NULL means "no credited time recorded for this
// (room, session) yet" — every row that existed before this column shipped,
// and every row created afterward until its session's FIRST valid heartbeat
// in that room, stays NULL forever rather than being backfilled from
// joined_at/created_at (recordHeartbeat()'s own server-clock dedup is the
// only thing ever allowed to turn NULL into a number — see its own comment
// below). Must run AFTER the room_participants CREATE TABLE above, same as
// every other ensureColumn() call in this file.

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

// The legacy FK repair can rebuild room_participants; add personal timing
// only after it finishes, otherwise that rebuild can discard the new column.
ensureColumn(
  "room_participants",
  "reasoning_seconds",
  "ALTER TABLE room_participants ADD COLUMN reasoning_seconds INTEGER",
);


// Additive, nullable: a host-ended-unsolved room keeps its existing status
// ('waiting' or 'active' — never 'solved', see guards in src/routes/rooms.ts)
// and gains closed_at as the one new fact, rather than rebuilding the status
// CHECK constraint (like ensureRoomsHaveWaitingStatus above) to add a new
// status value. NULL (every existing room, and every room that simply hasn't
// been ended) means "not closed" throughout this file and routes/rooms.ts.
ensureColumn("rooms", "closed_at", "ALTER TABLE rooms ADD COLUMN closed_at TEXT");

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
  slug: string | null;
  title: string;
  premise: string;
  solution: string;
  author_session_id: string | null;
  shared: boolean;
  cover_path: string | null;
}

export interface LobbyRoom {
  id: string;
  code: string;
  name: string | null;
  title: string;
  slug: string | null;
  cover_path: string | null;
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
  // Set once, by the host ending an unsolved investigation (POST
  // /rooms/:code/end) — never alongside status 'solved'. NULL means never
  // ended early.
  closed_at: string | null;
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

const PUZZLE_COLUMNS = "id, slug, title, premise, solution, author_session_id, shared, cover_path";

function rowToPuzzle(row: {
  id: string;
  slug: string | null;
  title: string;
  premise: string;
  solution: string;
  author_session_id: string | null;
  shared: number;
  cover_path: string | null;
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

export function isPuzzleAvailable(puzzleId: string, viewerSessionId?: string): boolean {
  const row = db.prepare("SELECT shared, author_session_id AS authorSessionId FROM puzzles WHERE id = ?").get(puzzleId) as
    | { shared: number; authorSessionId: string | null }
    | undefined;
  return Boolean(row && (row.shared || (viewerSessionId && row.authorSessionId === viewerSessionId)));
}

export function createAuthoredPuzzle(args: {
  title: string;
  premise: string;
  solution: string;
  authorSessionId: string;
  shared: boolean;
  coverPath: string | null;
}): Puzzle {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO puzzles (id, title, premise, solution, author_session_id, shared, cover_path)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    args.title,
    args.premise,
    args.solution,
    args.authorSessionId,
    args.shared ? 1 : 0,
    args.coverPath,
  );
  return rowToPuzzle(
    db.prepare(`SELECT ${PUZZLE_COLUMNS} FROM puzzles WHERE id = ?`).get(id) as Parameters<
      typeof rowToPuzzle
    >[0],
  );
}

// Never selects `solution` — the list a room-creation picker renders from
// can't leak an answer just by existing, not merely by the UI choosing not
// to show it.
// `viewerSessionId` controls two things at once, both computed here so no
// caller ever has to see a raw author_session_id to answer either question:
//   - which ROWS are visible at all: a shared(=1) puzzle to anyone, plus a
//     private(=0) puzzle ONLY to its own author (viewerSessionId === that
//     row's author) — this is also what keeps another player's private case
//     out of the Case Library/room-creation picker entirely, not just hidden
//     in the UI;
//   - `isMine` on each surviving row: true only when viewerSessionId equals
//     that row's author_session_id, false otherwise (including for every
//     other visitor looking at the same shared row) — never derived from or
//     exposing the raw author_session_id itself to the caller.
// Passing no viewerSessionId preserves the original public-library behavior
// (shared rows only, isMine always false) for every call site that has no
// viewer context (e.g. community.ts's title list).
export function listAvailablePuzzles(
  search?: string,
  viewerSessionId?: string,
): {
  id: string;
  slug: string | null;
  title: string;
  premise: string;
  authorLabel: string | null;
  usageCount: number;
  coverPath: string | null;
  isMine: boolean;
}[] {
  const like = search ? `%${search.replace(/[%_]/g, (m) => `\\${m}`)}%` : null;
  const visibility = viewerSessionId ? "(p.shared = 1 OR p.author_session_id = ?)" : "p.shared = 1";
  const visibilityArgs = viewerSessionId ? [viewerSessionId] : [];
  const searchClause = like ? "AND (p.title LIKE ? ESCAPE '\\' OR p.premise LIKE ? ESCAPE '\\')" : "";
  const searchArgs = like ? [like, like] : [];

  const rows = db
    .prepare(
      `SELECT p.id, p.slug, p.title, p.premise, p.author_session_id AS authorSessionId, p.cover_path AS coverPath,
              (SELECT COUNT(*) FROM rooms r WHERE r.puzzle_id = p.id) AS usageCount
       FROM puzzles p
       WHERE ${visibility} ${searchClause}
       ORDER BY p.created_at DESC`,
    )
    .all(...visibilityArgs, ...searchArgs) as {
    id: string;
    slug: string | null;
    title: string;
    premise: string;
    authorSessionId: string | null;
    usageCount: number;
    coverPath: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    premise: r.premise,
    usageCount: r.usageCount,
    coverPath: r.coverPath,
    authorLabel: r.authorSessionId
      ? (getProfile(r.authorSessionId).nickname ?? "Anonymous author")
      : null,
    isMine: viewerSessionId !== undefined && r.authorSessionId === viewerSessionId,
  }));
}

// Who's allowed to GET a puzzle's uploaded cover image: the puzzle's own
// author (always, even for a private/unshared puzzle — the author wrote
// it), or a shared puzzle (public, same visibility rule every other puzzle
// listing already uses), or anyone who has actually joined a room playing
// this puzzle (so an invited player in a private-case room can see the
// cover their host already showed them, without making the puzzle
// independently guessable/public). Never checks the requesting session
// against the solution — this governs an image, not plot content.
export function canViewPuzzleCover(puzzleId: string, sessionId: string): boolean {
  const puzzle = db
    .prepare("SELECT author_session_id, shared FROM puzzles WHERE id = ?")
    .get(puzzleId) as { author_session_id: string | null; shared: number } | undefined;
  if (!puzzle) return false;
  if (puzzle.shared) return true;
  if (puzzle.author_session_id === sessionId) return true;
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM room_participants rp
         JOIN rooms r ON r.id = rp.room_id
         WHERE r.puzzle_id = ? AND rp.session_id = ?
         LIMIT 1`,
      )
      .get(puzzleId, sessionId),
  );
}

// A plain profile lookup, not displayLabel(): resolving who hosts a room
// (for a lobby card) shouldn't register that session as a room participant
// the way actually joining one does.
export function hostLabel(sessionId: string | null): string {
  if (!sessionId) return "Unknown host";
  const profile = getProfile(sessionId);
  if (!profile.nickname) return "Anonymous host";
  // Only a legacy EMOJI avatar is ever prefixed onto display text — an
  // image-preset id ("mystery", "observer") is an internal key, not
  // readable text, and must never render as if it were part of the name.
  return isLegacyEmojiAvatar(profile.avatar) ? `${profile.avatar} ${profile.nickname}` : profile.nickname;
}

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

const ROOM_COLUMNS = "id, code, name, puzzle_id, host_session_id, status, created_at, closed_at";

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

// Guarded against closed_at, not just status: a host-ended room keeps its
// pre-end status ('waiting' or 'active') forever, so the plain status check
// alone would let a closed 'waiting' room start again.
export function startRoom(roomId: string): void {
  db.prepare(
    "UPDATE rooms SET status = 'active' WHERE id = ? AND status = 'waiting' AND closed_at IS NULL",
  ).run(roomId);
}

export function transferHost(roomId: string, toSessionId: string): void {
  db.prepare("UPDATE rooms SET host_session_id = ? WHERE id = ? AND closed_at IS NULL").run(
    toSessionId,
    roomId,
  );
}

export function listActiveRooms(limit = 20): LobbyRoom[] {
  return db
    .prepare(
      `SELECT r.id, r.code, r.name, p.title, p.slug, p.cover_path, r.host_session_id, r.status
       FROM rooms r
       JOIN puzzles p ON p.id = r.puzzle_id
       WHERE r.status IN ('waiting', 'active') AND r.closed_at IS NULL
       ORDER BY r.created_at DESC, r.rowid DESC
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
      `SELECT r.id, r.code, r.name, p.title, p.slug, p.cover_path, r.host_session_id, r.status
       FROM rooms r
       JOIN puzzles p ON p.id = r.puzzle_id
       WHERE r.id = ? AND r.status IN ('waiting', 'active') AND r.closed_at IS NULL`,
    )
    .get(roomId) as LobbyRoom | undefined;
}

export function getRoomByCode(code: string): Room | undefined {
  return db
    .prepare(`SELECT ${ROOM_COLUMNS} FROM rooms WHERE code = ?`)
    .get(code.toUpperCase()) as Room | undefined;
}

// Backs GET /rooms/:code/cover (routes/rooms.ts) — the lobby-card thumbnail
// route. Deliberately scoped to a room code, not a bare puzzle id: this only
// ever serves an image for a room that's still actually LISTED (waiting or
// active, the same status filter listActiveRooms() uses), so a solved or
// never-existed room 404s exactly like it would disappear from the lobby.
// This is intentionally a narrower grant than canViewPuzzleCover() — "this
// room is publicly browsable in the lobby right now" is sufficient reason to
// show its cover image to anyone, even a puzzle the author kept unshared,
// because the lobby card itself (title included) is already equally public;
// nothing about the puzzle's premise, solution, or shared flag is exposed by
// this beyond what the lobby card already shows.
export function getListedRoomCoverPath(code: string): string | null | undefined {
  const row = db
    .prepare(
      `SELECT p.cover_path AS coverPath
       FROM rooms r
       JOIN puzzles p ON p.id = r.puzzle_id
       WHERE r.code = ? AND r.status IN ('waiting', 'active') AND r.closed_at IS NULL`,
    )
    .get(code.toUpperCase()) as { coverPath: string | null } | undefined;
  return row?.coverPath;
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

// The auto-generated label's exact shape as a prior version of this app
// generated it (brief life as "Anonymous Detective#N", before the
// English-only naming pass renamed the default to "Mystery Detective #N").
// Matched ONLY against this exact pattern — a custom nickname can't
// accidentally collide with it (nicknames aren't numbered like this), so
// this never touches a real player-chosen name, only the literal old
// auto-label text already sitting in room_participants/qa_entries rows from
// before this rename shipped.
const LEGACY_AUTO_LABEL = /^Anonymous Detective#(\d+)$/;

// Reformats a stored auto-label (old or current shape) to the current
// default's exact text, preserving the numeric suffix a room's own
// participant-count numbering already assigned — never re-numbers anyone,
// never touches a label that isn't this exact auto-generated pattern (a
// custom nickname passes through unchanged). Exported so both the live path
// (displayLabel(), below) and the historical-transcript rendering path
// (src/render/room.ts, public/client.js) upgrade the same literal old text
// the same way, without rewriting anything already stored on disk.
export function formatAutoLabel(label: string): string {
  const m = label.match(LEGACY_AUTO_LABEL);
  return m ? `Mystery Detective #${m[1]}` : label;
}

export function ensureParticipantLabel(roomId: string, sessionId: string): string {
  const existing = db
    .prepare("SELECT label FROM room_participants WHERE room_id = ? AND session_id = ?")
    .get(roomId, sessionId) as { label: string } | undefined;
  if (existing) return formatAutoLabel(existing.label);

  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM room_participants WHERE room_id = ?")
    .get(roomId) as { count: number };
  const label = `Mystery Detective #${count + 1}`;
  db.prepare(
    "INSERT INTO room_participants (room_id, session_id, label) VALUES (?, ?, ?)",
  ).run(roomId, sessionId, label);
  return label;
}

export interface Profile {
  nickname: string | null;
  avatar: string | null;
  bio: string | null;
  avatarImage: string | null;
}

export function getProfile(sessionId: string): Profile {
  const row = db
    .prepare("SELECT nickname, avatar, bio, avatar_image AS avatarImage FROM sessions WHERE id = ?")
    .get(sessionId) as Profile | undefined;
  return row ?? { nickname: null, avatar: null, bio: null, avatarImage: null };
}

// Deliberately leaves avatar_image untouched here — an uploaded avatar is
// set/cleared only by setAvatarImage() below (routes/profile.ts's own
// upload/remove handlers), never as a side effect of a plain nickname/bio/
// emoji-preset save. A profile-form submission that fails validation on one
// field (or simply doesn't touch the avatar section) must never silently
// wipe an avatar the player already uploaded.
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

// `avatarImage` is a bare server-generated filename (src/uploads.ts) or
// null to clear it back to the emoji-preset/default fallback — never a
// user-controlled path. Separate from setProfile() so uploading/removing an
// avatar image never has to also re-send (and risk re-validating away)
// nickname/bio/emoji in the same request.
export function setAvatarImage(sessionId: string, avatarImage: string | null): void {
  db.prepare("UPDATE sessions SET avatar_image = ? WHERE id = ?").run(avatarImage, sessionId);
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
  // Only a legacy EMOJI avatar is ever prefixed onto the nickname text — an
  // image-preset id is an internal key, never shown as text (its actual
  // avatar image renders separately via src/render/avatars.ts's
  // resolveAvatarImage(), not as part of this label string).
  return isLegacyEmojiAvatar(profile.avatar) ? `${profile.avatar} ${nickname}` : nickname;
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

// closed_at IS NULL guards against a room the host just ended becoming
// 'solved' anyway — see POST /rooms/:code/ask's own lock-held recheck in
// routes/rooms.ts, which re-reads the room before calling this but closes
// the same race window this WHERE clause closes at the SQL layer too.
export function markSolved(roomId: string): void {
  db.prepare("UPDATE rooms SET status = 'solved' WHERE id = ? AND closed_at IS NULL").run(roomId);
}

// Marks a room closed (host-ended-unsolved) exactly once — `closed_at IS
// NULL` makes a second call a no-op, and a room already 'solved' is never
// passed here (routes/rooms.ts's POST /rooms/:code/end rejects a terminal
// room before this runs). Returns whether this call was the one that
// actually closed it, so the caller can post the "ended" system notice only
// once, under the same ask-lock markSolved's own callers already hold.
export function markClosed(roomId: string): boolean {
  const result = db
    .prepare("UPDATE rooms SET closed_at = datetime('now') WHERE id = ? AND closed_at IS NULL AND status != 'solved'")
    .run(roomId);
  return result.changes > 0;
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

// Turns a never-yet-credited NULL into an explicit 0 the moment this
// (room, session) pair is confirmed to be a valid active participant taking
// a heartbeat (initial or resume) — never on an invalid/inactive one, and
// never with any duration attached. This exists only so "time tracked, none
// credited yet" (0) is distinguishable from "this row predates the feature,
// no tracking ever happened" (NULL) in profile history — the actual credited
// seconds are still only ever added by the COALESCE(...) UPDATE inside
// recordHeartbeat() below.
function initializeReasoningSecondsIfNull(roomId: string, sessionId: string): void {
  db.prepare(
    `UPDATE room_participants
     SET reasoning_seconds = 0
     WHERE room_id = ? AND session_id = ? AND reasoning_seconds IS NULL`,
  ).run(roomId, sessionId);
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
  const room = db.prepare("SELECT status, closed_at FROM rooms WHERE id = ?").get(roomId) as
    | { status: string; closed_at: string | null }
    | undefined;
  if (!room || room.status !== "active" || room.closed_at !== null) {
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
    initializeReasoningSecondsIfNull(roomId, sessionId);
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
    initializeReasoningSecondsIfNull(roomId, sessionId);
    return { ok: true, credited: false };
  }

  const seconds = Math.round(elapsedMs / 1000);
  if (seconds > 0) {
    db.prepare(`UPDATE stats SET value = CAST(value AS INTEGER) + ? WHERE key = ?`).run(
      seconds,
      REASONING_TOTAL_KEY,
    );
    // Same credited delta as the global total above, attributed to this
    // (room, session) pair's own column — NULL (never-yet-credited) is
    // turned into 0 first so the increment below always has a number to
    // add to, never NULL + seconds = NULL. This is the ONLY place that ever
    // writes this column: no backfill from joined_at/created_at anywhere
    // else, so a historical NULL always means "not recorded," never "zero."
    db.prepare(
      `UPDATE room_participants
       SET reasoning_seconds = COALESCE(reasoning_seconds, 0) + ?
       WHERE room_id = ? AND session_id = ?`,
    ).run(seconds, roomId, sessionId);
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

// --- Personal profile history (own investigations / own stories) --------

export interface InvestigationHistoryEntry {
  roomId: string;
  roomCode: string;
  puzzleTitle: string;
  joinedAtUtc: string;
  // "waiting"/"active" mirror the room's own live status; "solved" only
  // means the ROOM was solved by SOMEONE, never that this viewer personally
  // solved it — displayed as "Solved together" for exactly that reason, see
  // render side. "ended" is a host-closed room (closed_at set, status never
  // 'solved' — see markClosed()'s own guard).
  status: "waiting" | "active" | "solved" | "ended";
  reasoningSeconds: number | null;
}

// A session's OWN investigation history only — scoped by session_id in the
// WHERE clause, never a caller-supplied one (routes/profile.ts must only
// ever pass the session id resolved from the request's own cookie, never a
// query param). Ordered newest-joined-first with a stable rowid tiebreak,
// same bounded-pagination shape as listActiveRooms()/the lobby.
export function listOwnInvestigations(
  sessionId: string,
  opts: { limit: number; offset: number },
): { entries: InvestigationHistoryEntry[]; total: number } {
  const total = (
    db
      .prepare("SELECT COUNT(*) AS n FROM room_participants WHERE session_id = ?")
      .get(sessionId) as { n: number }
  ).n;

  const rows = db
    .prepare(
      `SELECT r.id AS roomId, r.code AS roomCode, p.title AS puzzleTitle,
              rp.joined_at AS joinedAtUtc, r.status AS roomStatus, r.closed_at AS closedAt,
              rp.reasoning_seconds AS reasoningSeconds
       FROM room_participants rp
       JOIN rooms r ON r.id = rp.room_id
       JOIN puzzles p ON p.id = r.puzzle_id
       WHERE rp.session_id = ?
       ORDER BY rp.joined_at DESC, r.rowid DESC
       LIMIT ? OFFSET ?`,
    )
    .all(sessionId, opts.limit, opts.offset) as {
    roomId: string;
    roomCode: string;
    puzzleTitle: string;
    joinedAtUtc: string;
    roomStatus: "waiting" | "active" | "solved";
    closedAt: string | null;
    reasoningSeconds: number | null;
  }[];

  const entries: InvestigationHistoryEntry[] = rows.map((r) => ({
    roomId: r.roomId,
    roomCode: r.roomCode,
    puzzleTitle: r.puzzleTitle,
    joinedAtUtc: r.joinedAtUtc,
    status: r.closedAt !== null ? "ended" : r.roomStatus,
    reasoningSeconds: r.reasoningSeconds,
  }));
  return { entries, total };
}

export interface OwnStoryEntry {
  puzzleId: string;
  title: string;
  createdAtUtc: string;
  shared: boolean;
  coverPath: string | null;
  slug: string | null;
}

// Never selects `solution` — same rule as listAvailablePuzzles(). Scoped to
// author_session_id = the viewer's own session, so this can safely include
// both shared AND private rows (a player's own private case is exactly the
// one place it's fine to show it outside the public library).
export function listOwnStories(
  sessionId: string,
  opts: { limit: number; offset: number },
): { entries: OwnStoryEntry[]; total: number } {
  const total = (
    db
      .prepare("SELECT COUNT(*) AS n FROM puzzles WHERE author_session_id = ?")
      .get(sessionId) as { n: number }
  ).n;

  const rows = db
    .prepare(
      `SELECT id AS puzzleId, title, created_at AS createdAtUtc, shared, cover_path AS coverPath, slug
       FROM puzzles
       WHERE author_session_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT ? OFFSET ?`,
    )
    .all(sessionId, opts.limit, opts.offset) as {
    puzzleId: string;
    title: string;
    createdAtUtc: string;
    shared: number;
    coverPath: string | null;
    slug: string | null;
  }[];

  return {
    entries: rows.map((r) => ({
      puzzleId: r.puzzleId,
      title: r.title,
      createdAtUtc: r.createdAtUtc,
      shared: Boolean(r.shared),
      coverPath: r.coverPath,
      slug: r.slug,
    })),
    total,
  };
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
// reviews aren't tied to any room, so there's no "Mystery Detective #N" to
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
