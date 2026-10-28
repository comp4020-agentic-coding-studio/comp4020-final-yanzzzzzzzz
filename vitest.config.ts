import { defineConfig } from "vitest/config";

// Every test in spec/ runs against the running app, which spec/global-setup.ts
// finds. Only spec/ runs: a test anywhere else needs adding to `include`.
//
// fileParallelism is off because every spec file shares ONE mutable resource
// by this repo's own design: the one running app process and its one SQLite
// database (spec/global-setup.ts finds a single already-running server, it
// doesn't spin up an isolated one per file). vitest's default is to run
// files in parallel worker processes, which made assertions like "the room I
// just created appears in listActiveRooms()'s top-20 lobby window" genuinely
// racy — not a bug in that function (a fixed-size lobby window is a real
// product choice), but a real cross-file race: several files creating rooms
// at the same moment can legitimately push a just-created room off a
// concurrently-running file's top-20 before its own assertion runs. Running
// spec files sequentially removes that race at the cost of wall-clock time
// this suite can afford (low double-digit seconds, not minutes).
export default defineConfig({
  test: {
    include: ["spec/**/*.test.ts"],
    globalSetup: ["./spec/global-setup.ts"],
    fileParallelism: false,
    isolate: false,
  },
});
