import { kvBackend, kvErrorCategory, kvGet, kvSet } from "@/lib/kv";
import { sbSelect, supabaseBackend } from "@/lib/supabase";

// Readiness probes behind GET /api/health/ready (see that route).


const CACHE_MS = 15_000;
const PROBE_TIMEOUT_MS = 2_500;

type Status = "ok" | "down" | "not_configured";
interface Snapshot {
  ready: boolean;
  checks: { kv: { status: Status; category?: string; latencyMs?: number }; database: { status: Status; latencyMs?: number } };
  checkedAt: string;
}

let cache: { at: number; snap: Snapshot } | null = null;

async function within<T>(p: Promise<T>): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error("timeout")), PROBE_TIMEOUT_MS)))]);
  } finally {
    clearTimeout(t);
  }
}

async function probeKv(): Promise<Snapshot["checks"]["kv"]> {
  if (kvBackend !== "redis") return { status: "not_configured" };
  const t0 = Date.now();
  try {
    await within(kvSet("health:ready:ping", t0, 60));
    await within(kvGet("health:ready:ping"));
    return { status: "ok", latencyMs: Date.now() - t0 };
  } catch (e) {
    const msg = (e as Error).message;
    return { status: "down", category: msg === "timeout" ? "timeout" : kvErrorCategory(e), latencyMs: Date.now() - t0 };
  }
}

async function probeDb(): Promise<Snapshot["checks"]["database"]> {
  if (supabaseBackend !== "supabase") return { status: "not_configured" };
  const t0 = Date.now();
  try {
    await within(sbSelect("ops_tx_events", "select=id&limit=1"));
    return { status: "ok", latencyMs: Date.now() - t0 };
  } catch {
    return { status: "down", latencyMs: Date.now() - t0 };
  }
}

export async function readiness(now = Date.now()): Promise<Snapshot> {
  if (cache && now - cache.at < CACHE_MS) return cache.snap;
  const [kv, database] = await Promise.all([probeKv(), probeDb()]);
  // "not_configured" is not ready in a deployment that is supposed to have it;
  // production sets both, so only an explicit "ok" counts.
  const snap: Snapshot = { ready: kv.status === "ok" && database.status === "ok", checks: { kv, database }, checkedAt: new Date(now).toISOString() };
  cache = { at: now, snap };
  return snap;
}

/** Test hook. */
export function resetReadinessCache() {
  cache = null;
}
