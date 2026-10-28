// Serializes POST /rooms/:code/ask within ONE room: two concurrent
// submissions to the same room must never both reach the judge, since
// either could be acting on a room snapshot the other has since made stale
// (a guess that just solved it, a host that just changed) — tryLockRoom
// returning false is what lets the route answer with an explicit "busy"
// notice instead of silently racing two judge calls (and possibly two
// markSolved calls) against the same room.
//
// A plain in-memory Set, not a real distributed lock — correct only because
// this app's fixed deploy shape is one Fly machine running one process
// (fly.toml), never two instances sharing a room. A second instance would
// need a real lock (e.g. a row in the database), not this.
const lockedRooms = new Set<string>();

export function tryLockRoom(roomId: string): boolean {
  if (lockedRooms.has(roomId)) return false;
  lockedRooms.add(roomId);
  return true;
}

export function unlockRoom(roomId: string): void {
  lockedRooms.delete(roomId);
}
