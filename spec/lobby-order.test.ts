import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("keeps the newest rooms in the lobby when more than twenty share the same timestamp", () => {
  const dir = mkdtempSync(join(tmpdir(), "turtle-lobby-tie-"));
  try {
    // Separate process: db.ts opens SQLite at import time, so this fixture
    // must not borrow the HTTP test server or another spec's module cache.
    const result = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { db, listActiveRooms } from './src/db.ts';
      const puzzle = db.prepare('SELECT id FROM puzzles LIMIT 1').get();
      const insert = db.prepare("INSERT INTO rooms (id, code, puzzle_id, status, created_at) VALUES (?, ?, ?, 'waiting', '2026-10-01 12:00:00')");
      for (let i = 0; i < 25; i++) insert.run('tie-' + i, 'T' + String(i).padStart(4, '0'), puzzle.id);
      console.log(JSON.stringify(listActiveRooms().map(room => room.code)));
      db.close();
    `], { encoding: "utf8", env: { ...process.env, DATA_DIR: dir } });
    const codes = JSON.parse(result.trim());
    expect(codes).toEqual(Array.from({ length: 20 }, (_, i) => `T${String(24 - i).padStart(4, "0")}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});