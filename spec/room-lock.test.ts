import { expect, it } from "vitest";
import { tryLockRoom, unlockRoom } from "../src/room-lock.ts";

// Unit-level, deterministic coverage of src/room-lock.ts's own locking
// semantics — the exact mechanism src/routes/rooms.ts's POST /ask uses to
// keep two concurrent requests in the SAME room from both reaching the
// judge. An HTTP-level race (two real fetch() calls landing on the live
// test server at once) can't be made reliably deterministic in a test
// environment — how far each request gets before the other arrives depends
// on Node's own I/O scheduling, not anything this suite controls — so the
// exact acquire/reject/release contract is pinned here instead, where it's
// fully under this test's control. spec/room-lifecycle.test.ts's own
// concurrent-ask test exercises this through the real route as a
// best-effort integration check on top of this.
it("rejects a second lock attempt on the same room while the first is still held", () => {
  const roomId = `room-${Math.random()}`;
  expect(tryLockRoom(roomId)).toBe(true);
  expect(tryLockRoom(roomId)).toBe(false);
  unlockRoom(roomId);
});

it("allows locking again once the holder releases it", () => {
  const roomId = `room-${Math.random()}`;
  expect(tryLockRoom(roomId)).toBe(true);
  unlockRoom(roomId);
  expect(tryLockRoom(roomId)).toBe(true);
  unlockRoom(roomId);
});

it("never confuses two different rooms' locks with each other", () => {
  const roomA = `room-a-${Math.random()}`;
  const roomB = `room-b-${Math.random()}`;
  expect(tryLockRoom(roomA)).toBe(true);
  // A lock on room A must never block room B — these are two independent
  // rooms with two independent judge calls in flight.
  expect(tryLockRoom(roomB)).toBe(true);
  unlockRoom(roomA);
  unlockRoom(roomB);
});

it("unlocking an already-unlocked room is a harmless no-op, not an error", () => {
  const roomId = `room-${Math.random()}`;
  expect(() => unlockRoom(roomId)).not.toThrow();
  expect(tryLockRoom(roomId)).toBe(true);
  unlockRoom(roomId);
});
