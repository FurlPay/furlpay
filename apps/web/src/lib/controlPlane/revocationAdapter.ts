import { kvGet, kvSet, kvDel } from "@/lib/kv";
import { log } from "@/lib/log";
import { loadRevocations, insertRevocation, controlPlaneDurable } from "./store";
import {
  DEFAULT_MAX_STALENESS_MS,
  type KillSwitchState,
  type RevocationEntry,
  type RevocationLookup,
  type RevocationSubjectKind,
} from "@furlpay/control-plane";

// ---------------------------------------------------------------------------
// The production revocation adapter.
//
// WHAT THE ENGINE NEEDS AND WHY THIS IS DELICATE. `evaluateRevocation` is pure:
// it takes a SNAPSHOT and denies on three things — the lookup failing, the
// snapshot being stale, and any subject in the chain being revoked. The adapter
// supplies the snapshot, and two of those three protections are only as good as
// what it puts in it.
//
// `fetchedAtMs` IS THE SOURCE OBSERVATION TIME, NOT THE CACHE READ TIME. This is
// the single most consequential line in the file. Stamping "now" when we read
// the cache would make every snapshot permanently fresh and delete the staleness
// bound entirely — the engine would keep trusting a cached "nothing is revoked"
// forever, which is the exact failure the bound exists to prevent. So the
// timestamp is written when the data leaves POSTGRES and travels with it.
//
// FAIL CLOSED ON EVERY PATH. Redis down, Postgres down, migration not applied,
// JSON unparseable: each returns `{ ok: false }`, and the engine denies. The
// tempting alternative — "Redis is down, fall back to Postgres and carry on" —
// is implemented here, but with the source timestamp, so a slow fallback still
// fails the staleness check rather than pretending to be fresh.
//
// NO DURABLE BACKEND IS A REFUSAL, NOT AN EMPTY LIST. `controlPlaneDurable()`
// false means 0020 was never applied. An empty revocation list would then read
// as "nothing is revoked", which is how a deployment with no control-plane
// tables authorizes everything. It returns a failed lookup instead.
// ---------------------------------------------------------------------------

/** Cache TTL. Deliberately equal to the default staleness bound: a cache entry
 *  that outlives what the engine will accept is an entry that can only ever
 *  produce a denial, and expiring it instead means the next read refreshes. */
const SNAPSHOT_TTL_SECONDS = Math.max(1, Math.floor(DEFAULT_MAX_STALENESS_MS / 1000));

const snapshotKey = (organizationId: string) => `cp:revocations:${organizationId}`;
const killSwitchKey = (scope: "global" | "organization", organizationId?: string) =>
  scope === "global" ? "cp:killswitch:global" : `cp:killswitch:org:${organizationId}`;

interface CachedSnapshot {
  entries: RevocationEntry[];
  /** When the data left POSTGRES. Never re-stamped on a cache read. */
  fetchedAtMs: number;
}

// ── Kill switch ────────────────────────────────────────────────────────────

/**
 * Read the kill switch, global first.
 *
 * Global outranks per-organization: an incident that stops everything must not
 * be escapable by a tenant not having its own switch set.
 */
async function readKillSwitch(organizationId: string): Promise<KillSwitchState> {
  const [global, org] = await Promise.all([
    kvGet<KillSwitchState>(killSwitchKey("global")),
    kvGet<KillSwitchState>(killSwitchKey("organization", organizationId)),
  ]);
  if (global?.engaged) return { ...global, scope: "global" };
  if (org?.engaged) return { ...org, scope: "organization", organizationId };
  return { engaged: false, scope: "global" };
}

/** Engage or release the kill switch. Ops action; every call is logged. */
export async function setKillSwitch(input: {
  scope: "global" | "organization";
  organizationId?: string;
  engaged: boolean;
  reason: string;
  engagedBy: string;
}): Promise<void> {
  const key = killSwitchKey(input.scope, input.organizationId);
  if (!input.engaged) {
    await kvDel(key);
    log.warn("control-plane kill switch RELEASED", {
      scope: input.scope,
      organizationId: input.organizationId,
      by: input.engagedBy,
      reason: input.reason,
    });
    return;
  }
  const state: KillSwitchState = {
    engaged: true,
    scope: input.scope,
    organizationId: input.organizationId,
    reason: input.reason,
    engagedAt: new Date().toISOString(),
    engagedBy: input.engagedBy,
  };
  // No TTL. A kill switch that expires on its own is a kill switch that turns
  // itself off during an incident nobody has finished investigating.
  await kvSet(key, state);
  log.error("control-plane kill switch ENGAGED", {
    scope: input.scope,
    organizationId: input.organizationId,
    by: input.engagedBy,
    reason: input.reason,
  });
}

// ── Snapshot ───────────────────────────────────────────────────────────────

/**
 * Build the lookup the engine evaluates.
 *
 * Order: kill switch, then cache, then Postgres. The kill switch is read on
 * every call regardless of cache state, because the one thing that must take
 * effect immediately is the control an operator reaches for during an incident.
 */
export async function revocationLookup(organizationId: string): Promise<RevocationLookup> {
  if (!controlPlaneDurable()) {
    return {
      ok: false,
      error:
        "control-plane tables are unavailable (migration 0020 not applied); an empty revocation " +
        "list would read as 'nothing is revoked'",
    };
  }

  let killSwitch: KillSwitchState;
  try {
    killSwitch = await readKillSwitch(organizationId);
  } catch (e) {
    // Unable to tell whether an operator has stopped everything. That is not a
    // situation in which to keep moving money.
    return { ok: false, error: `kill switch unreadable: ${(e as Error).message}` };
  }

  // Cache read. A miss or a fault falls through to Postgres rather than failing,
  // because Redis being down should degrade latency, not availability — and the
  // staleness bound still applies to whatever we end up with.
  let cached: CachedSnapshot | null = null;
  try {
    cached = await kvGet<CachedSnapshot>(snapshotKey(organizationId));
  } catch (e) {
    log.warn("revocation snapshot cache unreadable; reading through", {
      organizationId,
      error: (e as Error).message,
    });
  }

  if (cached && Array.isArray(cached.entries) && typeof cached.fetchedAtMs === "number") {
    return {
      ok: true,
      snapshot: {
        killSwitch,
        entries: cached.entries,
        // The SOURCE time, carried through the cache untouched.
        fetchedAtMs: cached.fetchedAtMs,
      },
    };
  }

  // Read through. Stamp BEFORE the await so the timestamp cannot be later than
  // the observation — a timestamp taken after a slow query would overstate the
  // data's freshness by exactly the query duration.
  const fetchedAtMs = Date.now();
  let entries: RevocationEntry[] | null;
  try {
    entries = await loadRevocations(organizationId);
  } catch (e) {
    return { ok: false, error: `revocation store unavailable: ${(e as Error).message}` };
  }
  if (entries === null) {
    return {
      ok: false,
      error: "revocation store returned no result (migration 0020 not applied)",
    };
  }

  // Cache write is best-effort: failing to cache is a latency problem, and
  // denying a legitimate payment over it would be worse than the extra query.
  void kvSet(snapshotKey(organizationId), { entries, fetchedAtMs }, SNAPSHOT_TTL_SECONDS).catch(
    (e) => log.warn("revocation snapshot cache write failed", { organizationId, error: e?.message })
  );

  return { ok: true, snapshot: { killSwitch, entries, fetchedAtMs } };
}

// ── Writes ─────────────────────────────────────────────────────────────────

/**
 * Revoke a subject and make it visible immediately.
 *
 * THE CACHE IS INVALIDATED AFTER THE WRITE LANDS, NOT BEFORE. Invalidating first
 * leaves a window where a concurrent read repopulates the cache from a Postgres
 * that has not yet been written, and the stale entry then survives for a full
 * TTL — with the revocation already believed to be in effect.
 *
 * If the invalidation itself fails the revocation is still durable, and the
 * staleness bound caps how long the stale snapshot can be trusted. That is the
 * bound doing its job rather than an error to swallow, so it is logged loudly
 * and the call still reports success.
 */
export async function revokeSubject(input: {
  organizationId: string;
  kind: RevocationSubjectKind;
  subjectId: string;
  reason: string;
  revokedBy: string;
}): Promise<boolean> {
  const written = await insertRevocation(input);
  if (!written) return false;

  try {
    await kvDel(snapshotKey(input.organizationId));
  } catch (e) {
    log.error(
      "revocation written but snapshot cache not invalidated; the staleness bound now caps exposure",
      {
        organizationId: input.organizationId,
        kind: input.kind,
        maxStalenessMs: DEFAULT_MAX_STALENESS_MS,
        error: (e as Error).message,
      }
    );
  }

  log.warn("control-plane subject revoked", {
    organizationId: input.organizationId,
    kind: input.kind,
    subjectId: input.subjectId,
    by: input.revokedBy,
  });
  return true;
}

/** Drop the cached snapshot. Exposed for tests and for an ops "force refresh". */
export async function invalidateRevocationCache(organizationId: string): Promise<void> {
  await kvDel(snapshotKey(organizationId)).catch(() => {});
}
