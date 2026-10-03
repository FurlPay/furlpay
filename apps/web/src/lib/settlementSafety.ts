import { kvGet, kvIncr, kvListPush, kvListRange, kvSet } from "@/lib/kv";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { financialEnvironment } from "@/lib/flags";
import { deliverSecurityAlert } from "@/lib/ops/alertSink";

// ---------------------------------------------------------------------------
// Settlement safety controller — the circuit breaker at the IRREVERSIBLE
// boundary (lib/x402Settler.ts, immediately before writeContract).
//
// WHY THIS EXISTS NEXT TO lib/ops/controls.ts. The rail pauses there are
// checked at the top of SOME routes (x402/fx, mpp/fx, transfers/gasless, ...)
// and nowhere else. Every path that actually broadcasts — the public
// /api/x402/facilitator/settle, /api/account/fund, the x402 paywall
// (lib/x402.ts), MPP (lib/mpp.ts) — reaches defaultSettler() without one, and
// a request that passed a route-top check before a pause landed settles anyway.
// And controls.ts deliberately does NOT fail closed on a store error. That is
// the right call for a quote endpoint and the wrong one for a broadcast.
//
// So this module is consulted by the settler itself, every time, and:
//   - FAILS CLOSED. If the state cannot be read, settlement is refused. "We
//     could not prove it is safe" is a refusal, never a pass.
//   - Is STICKY. A halt clears only through the recovery workflow below —
//     never because the triggering signal went away, never on restart (state
//     is in Redis, not memory), never by a worker writing NORMAL.
//   - Is EPOCH-FENCED. Every trip increments a per-scope epoch BEFORE it
//     writes its state. NORMAL is honoured only when it was written at the
//     current epoch, so a resume racing a new trip can never clear that trip:
//     the moment the increment lands, every gate refuses.
//
// SCOPES. "global" (shared signer / ledger / control plane) and one per network
// ("network:arbitrum", ...). The settler checks both; a network halt does not
// stop other networks, a global halt stops all of them. There is no narrower
// scope (asset, route) because every settlement on a network shares ONE
// fee-payer key and ONE RPC trust root — they cannot be isolated from each
// other, so pretending to would be the "unrelated route stays healthy" error.
//
// WHAT THIS CANNOT DO. It stops FurlPay broadcasting. It cannot recall a
// transaction already on the wire, and it cannot stop a payer's signed EIP-3009
// authorization being submitted by SOMEONE ELSE — the authorization is a bearer
// instrument on-chain, and any party holding it may relay it until validBefore.
// ---------------------------------------------------------------------------

export type SafetyState = "NORMAL" | "DEGRADED" | "HALTED" | "RECOVERY_PENDING";
export type SafetyScope = "global" | `network:${string}`;
export type IncidentSeverity = "high" | "critical";

export interface Approval {
  approver: string;
  at: string;
  /** Evidence the approver says they reviewed — free text, no customer data. */
  evidence: string;
}

export interface ScopeRecord {
  scope: SafetyScope;
  state: SafetyState;
  /** The epoch this record was written at. NORMAL is only valid at the current epoch. */
  epoch: number;
  since: string;
  incidentId?: string;
  severity?: IncidentSeverity;
  signal?: string;
  /** Detector output. Bounded; never secrets or customer PII. */
  evidence?: Record<string, unknown>;
  actor: string;
  mitigation?: { by: string; at: string; notes: string };
  approvals?: Approval[];
  policyVersion: string;
}

export interface TransitionEntry {
  scope: SafetyScope;
  from: SafetyState;
  to: SafetyState;
  epoch: number;
  incidentId?: string;
  signal?: string;
  actor: string;
  at: string;
  correlationId?: string;
}

/** Bump when the transition or approval rules change; recorded on every write. */
export const POLICY_VERSION = "settlement-safety/1";

const APPROVAL_TTL_MS = 30 * 60_000;
// The epoch counter must outlive any incident. kvIncr only sets a TTL when the
// key is created; ten years is "never" for this purpose.
const EPOCH_TTL_S = 10 * 365 * 24 * 3600;
const HISTORY_MAX = 500;

const stateKey = (s: SafetyScope) => `settle:safety:state:${s}`;
const epochKey = (s: SafetyScope) => `settle:safety:epoch:${s}`;
const HISTORY_KEY = "settle:safety:history";

export const networkScope = (network: string): SafetyScope => `network:${network}`;

export class SettlementHaltedError extends Error {
  readonly code = "settlement_halted";
  readonly scope: SafetyScope | "control_plane";
  readonly incidentId?: string;
  /** Set when the refusal came AFTER broadcast (receipt mismatch): the
   *  transaction is on-chain and its outcome is disputed, not failed. */
  readonly transaction?: string;
  constructor(scope: SafetyScope | "control_plane", reason: string, incidentId?: string, transaction?: string) {
    super(`settlement refused (${scope}): ${reason}`);
    this.scope = scope;
    this.incidentId = incidentId;
    this.transaction = transaction;
  }
}

// --- reading ---------------------------------------------------------------

async function currentEpoch(scope: SafetyScope): Promise<number> {
  const v = await kvGet<number>(epochKey(scope));
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Effective state of one scope. A NORMAL written at an older epoch means a trip
 *  happened and its own write was lost (or overwritten by a racing resume) —
 *  that is HALTED, not NORMAL. Throws on a store error; callers decide. */
export async function readScope(scope: SafetyScope): Promise<ScopeRecord> {
  const [rec, epoch] = await Promise.all([kvGet<ScopeRecord>(stateKey(scope)), currentEpoch(scope)]);
  if (!rec) {
    if (epoch === 0) {
      return { scope, state: "NORMAL", epoch: 0, since: new Date(0).toISOString(), actor: "system", policyVersion: POLICY_VERSION };
    }
    return fencedHalt(scope, epoch);
  }
  if (rec.state === "NORMAL" && rec.epoch !== epoch) return fencedHalt(scope, epoch, rec);
  return rec;
}

function fencedHalt(scope: SafetyScope, epoch: number, prior?: ScopeRecord): ScopeRecord {
  return {
    scope,
    state: "HALTED",
    epoch,
    since: prior?.since ?? new Date().toISOString(),
    signal: "epoch_fence",
    evidence: { reason: "a trip advanced the epoch but no matching state record exists", recordEpoch: prior?.epoch ?? null },
    actor: "system",
    policyVersion: POLICY_VERSION,
  };
}

/**
 * The gate. Called by the settler immediately before it signs. Resolves when
 * settlement on `network` may proceed; throws SettlementHaltedError otherwise —
 * including when the control plane cannot be read.
 *
 * Development with the in-memory KV is allowed through the same code path
 * (the in-memory store works on one process); production refuses the memory
 * backend inside lib/kv.ts, which lands here as a store error → refusal.
 */
export async function assertSettlementAllowed(network: string): Promise<void> {
  let records: ScopeRecord[];
  try {
    records = await Promise.all([readScope("global"), readScope(networkScope(network))]);
  } catch (e) {
    log.error("settlement safety state unreadable — refusing to settle", {
      network,
      error: (e as Error).message,
      environment: financialEnvironment(),
    });
    throw new SettlementHaltedError("control_plane", "safety state could not be read");
  }
  for (const r of records) {
    if (r.state !== "NORMAL") {
      throw new SettlementHaltedError(r.scope, `${r.state}${r.signal ? ` (${r.signal})` : ""}`, r.incidentId);
    }
  }
}

// --- tripping --------------------------------------------------------------

export interface TripInput {
  scope: SafetyScope;
  signal: string;
  severity: IncidentSeverity;
  evidence: Record<string, unknown>;
  /** "system:<detector>" for automatic trips, the operator's user id otherwise. */
  actor: string;
  correlationId?: string;
  /** DEGRADED is non-sticky (the monitor may clear it); HALTED needs recovery. */
  to?: "HALTED" | "DEGRADED";
}

/**
 * Move a scope to HALTED (or DEGRADED). Order matters and is the whole design:
 *   1. increment the epoch — from this instant every gate refuses this scope;
 *   2. write the state record with the evidence;
 *   3. append history, audit;
 *   4. notify — LAST, and a notification failure never undoes 1–3.
 * A trip never downgrades: HALTED/RECOVERY_PENDING are not overwritten by a
 * DEGRADED, and RECOVERY_PENDING tripped again goes back to HALTED with the new
 * incident (approvals already collected are discarded by the epoch change).
 */
export async function trip(input: TripInput): Promise<ScopeRecord> {
  const to = input.to ?? "HALTED";
  const prior = await readScope(input.scope).catch(() => null);
  if (to === "DEGRADED" && prior && (prior.state === "HALTED" || prior.state === "RECOVERY_PENDING")) {
    // Already stopped harder than this signal asks for. Keep the evidence trail.
    await appendHistory({
      scope: input.scope, from: prior.state, to: prior.state, epoch: prior.epoch,
      incidentId: prior.incidentId, signal: input.signal, actor: input.actor,
      at: new Date().toISOString(), correlationId: input.correlationId,
    }).catch(() => undefined);
    return prior;
  }

  const epoch = await kvIncr(epochKey(input.scope), EPOCH_TTL_S);
  const incidentId = `inc_${crypto.randomUUID()}`;
  const rec: ScopeRecord = {
    scope: input.scope,
    state: to,
    epoch,
    since: new Date().toISOString(),
    incidentId,
    severity: input.severity,
    signal: input.signal,
    evidence: boundEvidence(input.evidence),
    actor: input.actor,
    approvals: [],
    policyVersion: POLICY_VERSION,
  };
  await kvSet(stateKey(input.scope), rec);
  await appendHistory({
    scope: input.scope, from: prior?.state ?? "NORMAL", to, epoch, incidentId,
    signal: input.signal, actor: input.actor, at: rec.since, correlationId: input.correlationId,
  }).catch((e) => log.error("settlement safety history append failed", { error: (e as Error).message }));
  audit("ops.settlement_safety_tripped", input.actor, {
    scope: input.scope, state: to, incidentId, signal: input.signal, severity: input.severity,
  });
  log.error("settlement safety tripped", { scope: input.scope, state: to, incidentId, signal: input.signal });

  try {
    await deliverSecurityAlert({
      id: incidentId,
      kind: `settlement_${to.toLowerCase()}`,
      severity: input.severity,
      detail:
        `Settlement ${to} on ${input.scope} — signal ${input.signal}. Incident ${incidentId}. ` +
        `FurlPay will not broadcast on this scope until recovery is approved at /api/ops/settlement-safety. ` +
        `Runbook: docs/SETTLEMENT-CIRCUIT-BREAKER-RUNBOOK.md.`,
      actor: input.actor,
      ts: rec.since,
    });
  } catch (e) {
    // The halt is already durable. A paging failure is logged, never fatal.
    log.error("settlement safety alert delivery failed (halt remains in force)", {
      incidentId, error: (e as Error).message,
    });
  }
  return rec;
}

/** Clear a DEGRADED scope once its signal has passed. The ONLY automatic
 *  return to NORMAL, and only from DEGRADED at the same epoch. */
export async function clearDegraded(scope: SafetyScope, actor: string): Promise<RecoveryResult | null> {
  const rec = await readScope(scope);
  if (rec.state !== "DEGRADED") return null;
  return writeNormal(scope, rec, actor);
}

// --- recovery --------------------------------------------------------------

export interface RecoveryChecks {
  /** Health detectors re-run now, for this scope. */
  healthy: boolean;
  /** Settlements still pending (unknown outcome) on this scope. */
  unresolvedSettlements: number;
  detail?: Record<string, unknown>;
}

export type RecoveryResult =
  | { ok: true; record: ScopeRecord }
  | { ok: false; code: string; message: string; record?: ScopeRecord };

/** Minimum distinct approvers to resume. Critical incidents default to two
 *  (separation of duties); SETTLEMENT_RECOVERY_MIN_APPROVERS may raise, never
 *  lower, the floor for either severity. */
export function requiredApprovals(severity: IncidentSeverity | undefined, env: NodeJS.ProcessEnv = process.env): number {
  const floor = severity === "high" ? 1 : 2; // unknown severity is treated as critical
  const configured = Number(env.SETTLEMENT_RECOVERY_MIN_APPROVERS);
  return Number.isInteger(configured) && configured > floor ? configured : floor;
}

/** HALTED → RECOVERY_PENDING. Requires mitigation notes AND passing checks.
 *  Settlement stays blocked in RECOVERY_PENDING. */
export async function markMitigated(
  scope: SafetyScope,
  actor: string,
  notes: string,
  checks: RecoveryChecks,
  incidentId: string,
): Promise<RecoveryResult> {
  const rec = await readScope(scope);
  if (rec.state !== "HALTED") return { ok: false, code: "not_halted", message: `scope is ${rec.state}`, record: rec };
  if (rec.incidentId !== incidentId) return { ok: false, code: "incident_mismatch", message: "incident id does not match the active incident", record: rec };
  const gate = checksBlock(checks);
  if (gate) return { ...gate, record: rec };

  const next: ScopeRecord = {
    ...rec,
    state: "RECOVERY_PENDING",
    mitigation: { by: actor, at: new Date().toISOString(), notes: notes.slice(0, 2000) },
    approvals: [],
    policyVersion: POLICY_VERSION,
  };
  return fencedWrite(scope, rec, next, actor);
}

/**
 * Record one approval; resumes when the required count of DISTINCT, unexpired
 * approvals bound to this incident and epoch is reached. Replay-resistant by
 * construction: approvals live inside the record for one (incident, epoch), so
 * a re-trip discards them, and a repeat by the same approver counts once.
 * Checks are re-run on EVERY approval — a new anomaly or an unresolved
 * settlement blocks the final approval even if earlier ones were given.
 */
export async function approveRecovery(
  scope: SafetyScope,
  approver: string,
  evidence: string,
  checks: RecoveryChecks,
  incidentId: string,
  now: number = Date.now(),
): Promise<RecoveryResult> {
  const rec = await readScope(scope);
  if (rec.state !== "RECOVERY_PENDING") return { ok: false, code: "not_recovery_pending", message: `scope is ${rec.state}`, record: rec };
  if (rec.incidentId !== incidentId) return { ok: false, code: "incident_mismatch", message: "incident id does not match the active incident", record: rec };
  if (!evidence || evidence.trim().length < 8) return { ok: false, code: "evidence_required", message: "describe the evidence reviewed (>= 8 chars)", record: rec };
  const gate = checksBlock(checks);
  if (gate) return { ...gate, record: rec };

  // Expired approvals drop out; a repeat by the same approver replaces theirs.
  // Separation of duties: when more than one approval is required, at least one
  // approver must differ from whoever declared the mitigation.
  const fresh = (rec.approvals ?? []).filter((a) => now - Date.parse(a.at) < APPROVAL_TTL_MS && a.approver !== approver);
  const approvals = [...fresh, { approver, at: new Date(now).toISOString(), evidence: evidence.slice(0, 2000) }];
  const needed = requiredApprovals(rec.severity);
  const distinct = new Set(approvals.map((a) => a.approver));
  const mitigator = rec.mitigation?.by;
  const independent = [...distinct].some((a) => a !== mitigator);

  if (distinct.size < needed || (needed > 1 && !independent)) {
    const next: ScopeRecord = { ...rec, approvals, policyVersion: POLICY_VERSION };
    const w = await fencedWrite(scope, rec, next, approver);
    if (!w.ok) return w;
    return {
      ok: false,
      code: "awaiting_approvals",
      message: `${distinct.size}/${needed} approvals${needed > 1 && !independent ? " (one must differ from the mitigating operator)" : ""}`,
      record: w.record,
    };
  }

  audit("ops.settlement_safety_recovered", approver, {
    scope, incidentId, approvers: [...distinct], policyVersion: POLICY_VERSION,
  });
  return writeNormal(scope, { ...rec, approvals }, approver);
}

function checksBlock(checks: RecoveryChecks): { ok: false; code: string; message: string } | null {
  if (!checks.healthy) return { ok: false, code: "checks_failing", message: "health checks are not passing for this scope" };
  if (checks.unresolvedSettlements > 0) {
    return { ok: false, code: "unresolved_settlements", message: `${checks.unresolvedSettlements} settlement(s) still have no confirmed outcome` };
  }
  return null;
}

/** Write `next` only if the scope's epoch has not moved since `prior` was read.
 *  Re-checks after writing and re-halts if a trip slipped in between. */
async function fencedWrite(scope: SafetyScope, prior: ScopeRecord, next: ScopeRecord, actor: string): Promise<RecoveryResult> {
  if ((await currentEpoch(scope)) !== prior.epoch) {
    return { ok: false, code: "epoch_moved", message: "a new incident was raised on this scope; re-read and start again" };
  }
  await kvSet(stateKey(scope), next);
  if ((await currentEpoch(scope)) !== prior.epoch) {
    // A trip landed between our check and our write and we may have
    // overwritten its record. The gate already refuses (epoch fence), but put
    // a HALTED record back so operators see the truth.
    await kvSet(stateKey(scope), { ...fencedHalt(scope, await currentEpoch(scope)), since: new Date().toISOString() });
    return { ok: false, code: "epoch_moved", message: "a new incident was raised during this change; the scope remains halted" };
  }
  await appendHistory({
    scope, from: prior.state, to: next.state, epoch: prior.epoch, incidentId: prior.incidentId,
    signal: prior.signal, actor, at: new Date().toISOString(),
  }).catch(() => undefined);
  return { ok: true, record: next };
}

function writeNormal(scope: SafetyScope, prior: ScopeRecord, actor: string): Promise<RecoveryResult> {
  return fencedWrite(scope, prior, {
    scope,
    state: "NORMAL",
    epoch: prior.epoch,
    since: new Date().toISOString(),
    actor,
    incidentId: prior.incidentId,
    approvals: prior.approvals,
    mitigation: prior.mitigation,
    policyVersion: POLICY_VERSION,
  }, actor);
}

// --- automatic trips: enforce vs shadow ------------------------------------

/**
 * Whether detectors may persist a halt on their own. Default SHADOW: a new
 * automatic halt policy is not switched on silently — set
 * SETTLEMENT_SAFETY_AUTOHALT=enforce to enable it. In shadow mode a would-be
 * trip is written to the transition history (signal prefixed "shadow:") and
 * logged, and the scope is NOT halted. Shadow mode is observation, not
 * protection. Manual halts, the fail-closed gate, and per-request refusals are
 * unaffected by this setting.
 */
export function autoHaltMode(env: NodeJS.ProcessEnv = process.env): "enforce" | "shadow" {
  return env.SETTLEMENT_SAFETY_AUTOHALT === "enforce" ? "enforce" : "shadow";
}

/** Apply an automatic finding per the current mode. Never throws: the caller
 *  refuses its own request regardless, and a store failure here must not turn
 *  that refusal into a crash. */
export async function autoTrip(input: TripInput): Promise<"tripped" | "shadow" | "failed"> {
  try {
    if (autoHaltMode() === "enforce") {
      await trip(input);
      return "tripped";
    }
    log.warn("settlement safety (shadow): would trip", { scope: input.scope, signal: input.signal, to: input.to ?? "HALTED" });
    const cur = await readScope(input.scope).catch(() => null);
    await appendHistory({
      scope: input.scope,
      from: cur?.state ?? "NORMAL",
      to: cur?.state ?? "NORMAL",
      epoch: cur?.epoch ?? 0,
      signal: `shadow:${input.signal}`,
      actor: input.actor,
      at: new Date().toISOString(),
      correlationId: input.correlationId,
    });
    return "shadow";
  } catch (e) {
    log.error("settlement safety automatic trip failed", { scope: input.scope, signal: input.signal, error: (e as Error).message });
    return "failed";
  }
}

// --- history ---------------------------------------------------------------

async function appendHistory(entry: TransitionEntry): Promise<void> {
  await kvListPush(HISTORY_KEY, JSON.stringify(entry), HISTORY_MAX);
}

export async function transitionHistory(count = 100): Promise<TransitionEntry[]> {
  const raw = await kvListRange(HISTORY_KEY, count);
  return raw.flatMap((r) => {
    try {
      return [JSON.parse(r) as TransitionEntry];
    } catch {
      return [];
    }
  });
}

/** Keep evidence small and flat enough to store and page with: strings are
 *  truncated and the key count capped. Detectors are responsible for not
 *  passing customer data in the first place. */
function boundEvidence(ev: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ev).slice(0, 24)) {
    out[k] = typeof v === "string" ? v.slice(0, 300) : typeof v === "bigint" ? v.toString() : v;
  }
  return out;
}
