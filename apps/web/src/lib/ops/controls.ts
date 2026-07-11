import { NextResponse } from "next/server";
import { kvGet, kvSet, kvDel } from "@/lib/kv";
import { audit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Emergency controls â€” DURABLE, server-enforced rail pauses. Not decorative:
// every real money route calls assertRailActive() at its top, so a paused rail
// actually stops issuing quotes / accepting settlement across every serverless
// instance (state in Redis via lib/kv). A global pause halts all rails at once.
//
// State is fail-SAFE on read errors in one direction only: a control-plane KV
// blip must not silently unpause a rail, so any pause we successfully wrote
// stays until explicitly resumed. We do NOT fail-closed money on a KV read
// error (that would let an ops-store outage take down healthy rails); the
// per-rail liveOr503/live guards remain the settlement safety net.
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

/** Route guard: 503 when the rail is paused, else null. Call at the top of
 *  every real money handler, before any settlement work. */
export async function assertRailActive(rail: Rail): Promise<NextResponse | null> {
  const status = await railPaused(rail);
  if (!status.paused) return null;
  return NextResponse.json(
    {
      ok: false,
      error: { code: "rail_paused", message: `The ${rail} rail is paused (${status.scope}).` },
      meta: { requestId: `req_${Date.now().toString(36)}`, timestamp: new Date().toISOString() },
    },
    { status: 503 }
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

/** Snapshot of every control for /ops/controls and the overview matrix. */
export async function controlSnapshot(): Promise<{ global: PauseState; rails: Record<Rail, PauseState> }> {
  const [global, ...railStates] = await Promise.all([readFlag(GLOBAL_KEY), ...RAILS.map((r) => readFlag(railKey(r)))]);
  const rails = {} as Record<Rail, PauseState>;
  RAILS.forEach((r, i) => (rails[r] = railStates[i]));
  return { global, rails };
}
