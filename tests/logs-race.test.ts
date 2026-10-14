// Listing logs while retention pruning deletes them must never fail: a log that disappears between reading the folder
// and reading its size is simply not listed. (Build main failed on this race in tests/platform.test.ts, 2026-10-14.)
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { LogStore } from "../apps/table-host/src/logs.ts";

let dir = "";
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const meta = (id: string) => ({ id, tableName: "t", gameId: "g", gameVersion: "1", simulation: false, startedAt: "", endedAt: "", games: 1, format: "gametable-log/1" as const });

it("lists logs while pruning deletes them, without failing", async () => {
  dir = await mkdtemp(join(tmpdir(), "logs-race-"));
  const logs = new LogStore(dir, 7);
  const old = (Date.now() - 10 * 86400_000) / 1000;
  for (let round = 0; round < 5; round++) {
    for (let i = 0; i < 60; i++) {
      await logs.save(meta(`old-${round}-${i}`), [[]]);
      await utimes(join(dir, `old-${round}-${i}.zip`), old, old);
    }
    await logs.save(meta(`new-${round}`), [[]]);
    // List over and over for as long as the prune is deleting the 60 old logs one by one.
    let done = false;
    const pruning = logs.prune().then(() => (done = true));
    let lists = 0;
    while (!done) {
      expect((await logs.list()).map((l) => l.id)).toContain(`new-${round}`);
      lists++;
    }
    await pruning;
    expect(lists).toBeGreaterThan(0);
    expect((await logs.list()).map((l) => l.id).filter((id) => id.startsWith("old-"))).toEqual([]);
  }
});

it("a log folder that disappears lists as empty", async () => {
  dir = await mkdtemp(join(tmpdir(), "logs-race-"));
  const logs = new LogStore(join(dir, "missing", "logs"), 7);
  await logs.save(meta("a"), [[]]);
  await rm(join(dir, "missing"), { recursive: true });
  // The folder itself is recreated by list(); an empty list, not an error.
  expect(await logs.list()).toEqual([]);
});
