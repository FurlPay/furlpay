import { NextResponse } from "next/server";
import { kvGet, kvSet, kvDel } from "@/lib/kv";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// Emergency controls â€” DURABLE, server-enforced rail pauses. Not decorative:
// every real money route calls assertRailActive() at its top, so a paused rail
// actually stops issuing quotes / accepting settlement across every serverless
// instance (state in Redis via lib/kv). A global pause halts all rails at once.
//
// On a READ error the state is unknown, and unknown is never "active": a store
// outage must not silently resume a paused rail. assertRailActive answers a
// structured, retryable 503 `controls_unavailable` (it used to throw, which
// surfaced as a bare 500). railPaused itself still throws — settlementGuard
// depends on that to fail closed. Public status reads use controlSnapshotSafe.
// ---------------------------------------------------------------------------

export type Rail = "x402" | "mpp" | "lifi" | "cctp" | "transfers";
export const RAILS: Rail[] = ["x402", "mpp", "lifi", "cctp", "transfers"];

const GLOBAL_KEY = "ops:pause:global";
const railKey = (rail: Rail) => `ops:pause:rail:${rail}`;

export interface PauseState {
  paused: boolean;
  by?: string;
  at?: string;
  reason?: string;
}

async function readFlag(key: string): Promise<PauseState> {
  const v = await kvGet<PauseState>(key);
  return v ?? { paused: false };
}

/** True when the rail is currently blocked (its own pause OR the global pause). */
export async function railPaused(rail: Rail): Promise<{ paused: boolean; scope?: "global" | "rail"; state?: PauseState }> {
  const [g, r] = await Promise.all([readFlag(GLOBAL_KEY), readFlag(railKey(rail))]);
  if (g.paused) return { paused: true, scope: "global", state: g };
  if (r.paused) return { paused: true, scope: "rail", state: r };
  return { paused: false };
}

/**
 * The rail's control state, WITHOUT throwing.
 *
 * `railPaused` throws when the store cannot be read, and settlementGuard
 * relies on exactly that to fail closed — so it is left alone. This wrapper is
 * for callers that need to tell "not paused" from "could not find out" and
 * answer each honestly. An unreadable store is NEVER reported as "active".
 *
 * MEASURED ON furlpay.com (6 Oct 2026): the KV store answered every read with
 * 403 "reached current Fixed plan limits". Before this, that KvError escaped
 * every route that checked a pause and surfaced as a bare 500.
 */
export type RailControlState =
  | { kind: "active" }
  | { kind: "paused"; scope: "global" | "rail"; state?: PauseState }
  | { kind: "unknown"; reason: string };

export async function railControlState(rail: Rail): Promise<RailControlState> {
  try {
    const s = await railPaused(rail);
    return s.paused ? { kind: "paused", scope: s.scope!, state: s.state } : { kind: "active" };
  } catch (e) {
    const reason = errorCategory(e);
    log.warn("ops.controls.unreadable", { rail, reason });
    return { kind: "unknown", reason };
  }
}

/** A short, secret-free description of why the store could not be read. */
function errorCategory(e: unknown): string {
  const cat = (e as { category?: unknown })?.category;
  if (typeof cat === "string") return cat; // KvError: "plan_limit", "auth", "network", …
  return (e as Error)?.name || "unknown_error";
}

function controlsResponse(code: string, message: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, ...extra },
      meta: { requestId: `req_${Date.now().toString(36)}`, timestamp: new Date().toISOString() },
    },
    // Retryable, and the client is told when to try again.
    { status: 503, headers: { "Retry-After": "30", "Cache-Control": "no-store" } }
  );
}

/**
 * Route guard: 503 when the rail is paused, else null. Call at the top of
 * every real money handler, before any settlement work.
 *
 * When the pause state CANNOT BE READ the guard answers 503
 * `controls_unavailable` — fail closed, with no exceptions: a paused rail
 * stops issuing quotes as well as settling, so an unreadable pause must stop
 * both. The answer is structured and retryable (Retry-After) instead of the
 * bare 500 the escaped store error used to produce.
 */
export async function assertRailActive(rail: Rail): Promise<NextResponse | null> {
  const s = await railControlState(rail);
  if (s.kind === "active") return null;
  if (s.kind === "paused") {
    return controlsResponse("rail_paused", `The ${rail} rail is paused (${s.scope}).`);
  }
  return controlsResponse(
    "controls_unavailable",
    `The ${rail} rail's operational controls cannot be read right now, so it is not serving requests. Try again shortly.`,
    { rail, reason: s.reason }
  );
}

export async function setRailPause(rail: Rail, paused: boolean, actor: string, reason?: string): Promise<PauseState> {
  const state: PauseState = { paused, by: actor, at: new Date().toISOString(), reason };
  if (paused) await kvSet(railKey(rail), state);
  else await kvDel(railKey(rail));
  audit("ops.control_changed", actor, { control: `rail:${rail}`, paused, reason });
  return state;
}

export async function setGlobalPause(paused: boolean, actor: string, reason?: string): Promise<PauseState> {
  const state: PauseState = { paused, by: actor, at: new Date().toISOString(), reason };
  if (paused) await kvSet(GLOBAL_KEY, state);
  else await kvDel(GLOBAL_KEY);
  audit("ops.control_changed", actor, { control: "global", paused, reason });
  return state;
}

/**
 * Like controlSnapshot, but never throws: a flag that cannot be read is
 * reported as `unknown` (and not paused), and `available` says whether every
 * flag was read. Used by the PUBLIC status surfaces, which must answer during
 * a store outage — saying so — rather than fail.
 */
export async function controlSnapshotSafe(): Promise<{
  available: boolean;
  reason?: string;
  global: PauseState & { unknown?: boolean };
  rails: Record<Rail, PauseState & { unknown?: boolean }>;
}> {
  const keys = [GLOBAL_KEY, ...RAILS.map(railKey)];
  const results = await Promise.allSettled(keys.map(readFlag));
  let reason: string | undefined;
  const states = results.map((r) => {
    if (r.status === "fulfilled") return r.value;
    reason ??= errorCategory(r.reason);
    return { paused: false, unknown: true as const };
  });
  if (reason) log.warn("ops.controls.snapshot_unreadable", { reason });
  const rails = {} as Record<Rail, PauseState & { unknown?: boolean }>;
  RAILS.forEach((r, i) => (rails[r] = states[i + 1]));
  return { available: !reason, reason, global: states[0], rails };
}

/** Snapshot of every control for /ops/controls and the overview matrix. */
export async function controlSnapshot(): Promise<{ global: PauseState; rails: Record<Rail, PauseState> }> {
  const [global, ...railStates] = await Promise.all([readFlag(GLOBAL_KEY), ...RAILS.map((r) => readFlag(railKey(r)))]);
  const rails = {} as Record<Rail, PauseState>;
  RAILS.forEach((r, i) => (rails[r] = railStates[i]));
  return { global, rails };
}
