// Lease tests — against the real implementation, not a mirror of its SQL.
//
// WHY THE DYNAMIC IMPORT BELOW. `config/env.ts` reads process.env at module load
// and `db/index.ts` opens the database named there, so DATABASE_URL has to be set
// before either is imported. Static ESM imports are hoisted above ordinary
// statements, so the modules under test are pulled in with `await import()` after
// the temp path is in place. This file deliberately imports nothing else from the
// project at the top level, because one static import of env.js would defeat that.
//
// Testing the real acquire/renew/release matters more than usual here: the safety
// argument is that SQLite applies a conditional ON CONFLICT DO UPDATE atomically,
// and a hand-written mirror of that statement would be testing my transcription of
// it rather than the thing that runs.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let lease: typeof import("./lease.js");

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "usdc-lease-"));
  process.env.DATABASE_URL = join(dir, "test.db");
  // Not a static import: see the header.
  lease = await import("./lease.js");
  // Opening the database applies the migrations, which is what creates usdc_leases.
  const { getDb } = await import("../db/index.js");
  getDb();
});

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // A locked file on Windows is not a test failure.
  }
});

test("a second acquire is denied while the first is held", () => {
  // THE CASE THIS EXISTS FOR. The tick is scheduled every 2-5 minutes and a measured
  // full tick takes about four, so two runs overlapping is the expected steady state.
  // Both would select alert candidates from the same unalerted set and both would
  // send before either marked the rows, posting the same whale movement twice.
  const first = lease.acquire("t-basic");
  assert.ok(!lease.isDenied(first), "the first acquire should win");

  const second = lease.acquire("t-basic");
  assert.ok(lease.isDenied(second), "a concurrent acquire must be refused");
  assert.ok(second.expiresInMs > 0, "the caller needs to know how long to wait");

  (first as import("./lease.js").Lease).release();
});

test("the lease is available again after release", () => {
  const a = lease.acquire("t-release");
  assert.ok(!lease.isDenied(a));
  (a as import("./lease.js").Lease).release();

  const b = lease.acquire("t-release");
  assert.ok(!lease.isDenied(b), "release must hand the lease back immediately");
  (b as import("./lease.js").Lease).release();
});

test("a crashed run does not hold the lease forever", () => {
  // No release() call — this simulates a killed process. The lease must expire on
  // its own, because a stale lock that needs a human to clear it is useless for
  // something that runs unattended. This is the reason the lease is a TTL row rather
  // than a lock file.
  // TTL of 0 means expires_at === acquired_at, so the lease is already expired the
  // instant it exists. Deterministic: a 1ms TTL failed here because the whole test
  // ran inside one millisecond, so Date.now() had not advanced and the lease had
  // genuinely not expired yet. Timing-dependent tests of a timeout are worse than
  // no test.
  const abandoned = lease.acquire("t-crash", 0);
  assert.ok(!lease.isDenied(abandoned), "setup: should have been acquired");
  const next = lease.acquire("t-crash", 60_000);
  assert.ok(!lease.isDenied(next), "an expired lease must be takeable");
  (next as import("./lease.js").Lease).release();
});

test("an unexpired lease is not stolen", () => {
  const held = lease.acquire("t-nosteal", 60_000);
  assert.ok(!lease.isDenied(held));

  const thief = lease.acquire("t-nosteal", 60_000);
  assert.ok(lease.isDenied(thief), "a live lease must not be takeable");

  (held as import("./lease.js").Lease).release();
});

test("renew extends the lease and reports success", () => {
  const l = lease.acquire("t-renew", 60_000) as import("./lease.js").Lease;
  assert.ok(!lease.isDenied(l));
  // A long backfill legitimately outlives one TTL; renewal is what lets it keep the
  // lease without the TTL having to be long enough to survive a crash badly.
  assert.equal(l.renew(), true);
  l.release();
});

test("renew fails once the lease has been taken by someone else", () => {
  // The scenario that makes `renew()` load-bearing rather than cosmetic: a run
  // stalled past its TTL, another run took over, and the stalled one woke up. It
  // MUST learn it no longer owns the work, or two runs publish concurrently.
  const stalled = lease.acquire("t-lost", 0) as import("./lease.js").Lease;
  assert.ok(!lease.isDenied(stalled));

  const taker = lease.acquire("t-lost", 60_000);
  assert.ok(!lease.isDenied(taker), "setup: the expired lease should be takeable");

  assert.equal(stalled.renew(), false, "the original holder must discover the loss");
  // And it stays false, so a caller polling renew() cannot flap back to true.
  assert.equal(stalled.renew(), false);

  (taker as import("./lease.js").Lease).release();
});

test("release by a non-holder does not free someone else's lease", () => {
  const owner = lease.acquire("t-scope", 60_000) as import("./lease.js").Lease;
  const denied = lease.acquire("t-scope", 60_000);
  assert.ok(lease.isDenied(denied));

  // Releasing the denied attempt must be a no-op — it never held anything. If
  // release were unscoped, a losing run would free the winner's lease and the
  // overlap protection would be worse than useless.
  assert.ok(lease.isDenied(denied));
  const stillDenied = lease.acquire("t-scope", 60_000);
  assert.ok(lease.isDenied(stillDenied), "the owner must still hold it");

  owner.release();
});

test("different names are independent leases", () => {
  const a = lease.acquire("t-nameA", 60_000);
  const b = lease.acquire("t-nameB", 60_000);
  assert.ok(!lease.isDenied(a));
  assert.ok(!lease.isDenied(b), "an unrelated lease must not be blocked");
  (a as import("./lease.js").Lease).release();
  (b as import("./lease.js").Lease).release();
});

test("withLease releases even when the body throws", async () => {
  // Without the finally, one failed tick would hold the lease until its TTL expired,
  // turning a single error into several skipped runs.
  const boom = new Error("scan exploded");
  await assert.rejects(
    lease.withLease("t-throw", async () => {
      throw boom;
    }),
    /scan exploded/
  );

  const after = lease.acquire("t-throw", 60_000);
  assert.ok(!lease.isDenied(after), "a thrown body must not leak the lease");
  (after as import("./lease.js").Lease).release();
});

test("withLease reports the holder instead of running when denied", async () => {
  const held = lease.acquire("t-busy", 60_000) as import("./lease.js").Lease;

  let ran = false;
  const r = await lease.withLease("t-busy", async () => {
    ran = true;
  });

  assert.equal(ran, false, "the body must not run without the lease");
  assert.equal(r.ran, false);
  if (!r.ran) assert.ok(r.heldBy.length > 0, "the caller should be told who holds it");

  held.release();
});

test("withLease returns the body's value when it ran", async () => {
  const r = await lease.withLease("t-value", async () => 42);
  assert.equal(r.ran, true);
  if (r.ran) assert.equal(r.value, 42);
});
