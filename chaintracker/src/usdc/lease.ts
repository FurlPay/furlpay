// A single-writer lease for the scheduled tick.
//
// THE PROBLEM. `run-usdc.cmd tick` is driven by Windows Task Scheduler every 2-5
// minutes, and a measured tick takes around four minutes — twelve chains scanned
// sequentially against rate-limited endpoints. So overlap is not a corner case, it
// is the expected steady state, and the previous header comment simply asked the
// operator not to let it happen.
//
// What overlap actually costs, in order of severity:
//
//   1. DUPLICATE DISCORD MESSAGES. Two ticks select alert candidates from the same
//      `alerted = 0` set and both send before either marks the rows. The same
//      whale movement is posted twice, and nothing afterwards can tell that the two
//      messages were one event.
//   2. CURSOR REGRESSION. Both read the same cursor and both write one. The slower
//      writer can move a chain's cursor backwards, re-scanning a range. Harmless to
//      correctness — the UNIQUE index absorbs it — but it wastes the log budget the
//      scanner is carefully rationing.
//   3. SQLITE_BUSY. Two writers on one file, which surfaces as a scan error rather
//      than anything explanatory.
//
// THE SMALLEST THING THAT FIXES IT. A lease row in the database we already open.
// Not a lock file: a stale lock file after a crash requires a human to delete it,
// and this runs unattended. Not a distributed lock: there is exactly one machine.
//
// A crashed run cannot hold the lease forever because the lease EXPIRES. It is
// taken for a bounded TTL and renewed as the tick makes progress, so a long
// backfill keeps it while a killed process loses it within one TTL.
//
// The acquire is one statement, and that is what makes it safe: SQLite applies an
// `INSERT ... ON CONFLICT DO UPDATE ... WHERE` atomically, so two processes racing
// cannot both see a free lease. `changes()` reports whether this process won.

import { randomUUID } from "node:crypto";
import { getDb } from "../db/index.js";
import { makeLogger } from "../util/logger.js";

const log = makeLogger("usdc:lease");

/**
 * How long a lease is held before it is considered abandoned.
 *
 * Must exceed a normal tick, or a healthy run would have its lease stolen
 * mid-flight; a measured full tick is ~4 minutes. Must not be so long that a
 * crashed run blocks the schedule for an hour. Renewal is what lets a legitimately
 * long run (a cold-start backfill over twelve chains) keep going past this.
 */
export const LEASE_TTL_MS = 10 * 60 * 1000;

/**
 * Identifies ONE acquisition, so only that acquisition can renew or release it.
 *
 * Per-call, not per-process. A module-level constant would make two acquires within
 * one process indistinguishable, so a holder that had lost its lease to a *sibling
 * acquisition* could still renew it. Cross-process that never arose — different pids
 * — but scoping to the acquisition makes the ownership check exact rather than
 * accidentally correct, and it is what lets the loss case be tested at all.
 *
 * The pid is kept as a prefix purely so the value is readable in a log or in
 * `doctor` output when diagnosing who is holding the lease.
 */
function newHolderToken(): string {
  return `${process.pid}:${randomUUID().slice(0, 8)}`;
}

export interface Lease {
  name: string;
  holder: string;
  /** Extend the lease. Returns false if it was lost — stop work if so. */
  renew(): boolean;
  release(): void;
}

export interface LeaseDenied {
  heldBy: string;
  expiresInMs: number;
}

/**
 * Try to take a named lease.
 *
 * Returns the lease on success, or who holds it and for how long on failure. The
 * caller decides what to do — a tick should exit quietly, because "another tick is
 * running" is normal operation and not an error worth alarming about.
 */
export function acquire(name: string, ttlMs = LEASE_TTL_MS): Lease | LeaseDenied {
  const db = getDb();
  const holder = newHolderToken();
  const now = Date.now();
  const expires = now + ttlMs;

  // ONE STATEMENT, and that is the whole safety argument. The conditional DO UPDATE
  // means a row is only overwritten when the existing lease has expired, and SQLite
  // evaluates the conflict and the condition atomically — so two processes cannot
  // both be told they won.
  const r = db
    .prepare(
      `INSERT INTO usdc_leases (name, holder, acquired_at, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         holder = excluded.holder,
         acquired_at = excluded.acquired_at,
         expires_at = excluded.expires_at
       WHERE usdc_leases.expires_at <= ?`
    )
    .run(name, holder, now, expires, now);

  if (Number(r.changes) === 0) {
    const held = db
      .prepare("SELECT holder, expires_at AS expiresAt FROM usdc_leases WHERE name = ?")
      .get(name) as { holder: string; expiresAt: number } | undefined;
    return {
      heldBy: held?.holder ?? "unknown",
      expiresInMs: Math.max(0, (held?.expiresAt ?? now) - now),
    };
  }

  log.debug("lease acquired", { name, holder, ttlMs });

  let held = true;
  return {
    name,
    holder,
    renew(): boolean {
      if (!held) return false;
      // Scoped to this holder: if the lease was stolen after expiry, the update
      // matches nothing and the caller learns it no longer owns the work.
      const u = getDb()
        .prepare(
          `UPDATE usdc_leases SET expires_at = ?
            WHERE name = ? AND holder = ?`
        )
        .run(Date.now() + ttlMs, name, holder);
      if (Number(u.changes) === 0) {
        held = false;
        log.warn("lease lost while working — another run has taken it", { name });
        return false;
      }
      return true;
    },
    release(): void {
      if (!held) return;
      held = false;
      // Expire rather than delete, so the row remains as a record of the last
      // holder. `acquire` only cares that expires_at is in the past.
      getDb()
        .prepare("UPDATE usdc_leases SET expires_at = ? WHERE name = ? AND holder = ?")
        .run(Date.now() - 1, name, holder);
      log.debug("lease released", { name });
    },
  };
}

export function isDenied(r: Lease | LeaseDenied): r is LeaseDenied {
  return (r as LeaseDenied).heldBy !== undefined;
}

/**
 * Run `fn` while holding a lease, releasing it whatever happens.
 *
 * Returns null when the lease could not be taken. The `finally` is the part that
 * matters: without it a thrown error would leave the lease held until its TTL
 * expired, turning one failed tick into several skipped ones.
 */
export async function withLease<T>(
  name: string,
  fn: (lease: Lease) => Promise<T>,
  ttlMs = LEASE_TTL_MS
): Promise<{ ran: true; value: T } | { ran: false; heldBy: string; expiresInMs: number }> {
  const l = acquire(name, ttlMs);
  if (isDenied(l)) return { ran: false, heldBy: l.heldBy, expiresInMs: l.expiresInMs };
  try {
    return { ran: true, value: await fn(l) };
  } finally {
    l.release();
  }
}
