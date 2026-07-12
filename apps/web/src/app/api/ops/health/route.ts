import { NextRequest } from "next/server";
import { createPublicClient } from "viem";
import { requireOpsAdmin, opsOk } from "@/lib/ops/respond";
import { kvGet, kvSet } from "@/lib/kv";
import { sbSelect, supabaseBackend } from "@/lib/supabase";
import { EVM_CHAINS, rpcTransport } from "@/lib/x402Chains";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/ops/health — component-level dependency probes.
// Each probe is a real round-trip with a hard timeout; results are cached in
// KV for 30s so dashboard polling never becomes a probe storm against
// third-party services. Probes that need credentials the deployment doesn't
// have report "not_configured" rather than a fake status.
// ---------------------------------------------------------------------------

type CheckStatus = "operational" | "degraded" | "down" | "not_configured";
interface Check {
  status: CheckStatus;
  latencyMs?: number;
  blockNumber?: number;
  detail?: string;
}

const PROBE_TIMEOUT_MS = 2_500;
const DEGRADED_MS = 2_000;
const CACHE_KEY = "ops:health:snapshot";
const CACHE_TTL_S = 30;

async function timed(probe: () => Promise<Partial<Check>>): Promise<Check> {
  const started = Date.now();
  try {
    const extra = await Promise.race([
      probe(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("probe timeout")), PROBE_TIMEOUT_MS)),
    ]);
    const latencyMs = Date.now() - started;
    return { status: latencyMs >= DEGRADED_MS ? "degraded" : "operational", latencyMs, ...extra };
  } catch (e) {
    return { status: "down", latencyMs: Date.now() - started, detail: (e as Error).message.slice(0, 120) };
  }
}

async function probeRedis(): Promise<Check> {
  return timed(async () => {
    await kvGet("ops:health:ping");
    return {};
  });
}

async function probeSupabase(): Promise<Check> {
  if (supabaseBackend !== "supabase") return { status: "not_configured" };
  return timed(async () => {
    await sbSelect("ops_tx_events", "select=id&limit=1");
    return {};
  });
}

async function probeRpc(network: string): Promise<Check> {
  const chain = EVM_CHAINS[network];
  if (!chain) return { status: "not_configured" };
  return timed(async () => {
    const client = createPublicClient({ chain, transport: rpcTransport(network) });
    const blockNumber = await client.getBlockNumber();
    return { blockNumber: Number(blockNumber) };
  });
}

async function probeHttp(url: string): Promise<Check> {
  return timed(async () => {
    // Any HTTP answer (even 4xx) proves the service is reachable; only
    // transport failures and 5xx count against it.
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), cache: "no-store" });
    if (res.status >= 500) throw new Error(`http ${res.status}`);
    return {};
  });
}

function rollup(checks: Record<string, Check>): "healthy" | "degraded" | "unhealthy" {
  const critical = ["redis", "supabase", "arbitrum_rpc"];
  if (critical.some((k) => checks[k]?.status === "down")) return "unhealthy";
  const active = Object.values(checks).filter((c) => c.status !== "not_configured");
  if (active.some((c) => c.status === "down" || c.status === "degraded")) return "degraded";
  return "healthy";
}

export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;

  const cached = await kvGet<object>(CACHE_KEY);
  if (cached) return opsOk({ ...cached, cached: true });

  const iris = process.env.CCTP_IRIS_API_URL || "https://iris-api.circle.com";
  const [redis, supabase, arbitrum, base, irisCheck, lifi] = await Promise.all([
    probeRedis(),
    probeSupabase(),
    probeRpc("arbitrum"),
    probeRpc("base"),
    probeHttp(`${iris}/v2/burn/USDC/fees/3/3`),
    probeHttp("https://li.quest/v1/chains"),
  ]);

  const checks: Record<string, Check> = {
    redis,
    supabase,
    arbitrum_rpc: arbitrum,
    base_rpc: base,
    cctp_iris: irisCheck,
    lifi_api: lifi,
  };

  const snapshot = {
    status: rollup(checks),
    timestamp: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    checks,
  };
  await kvSet(CACHE_KEY, snapshot, CACHE_TTL_S);
  return opsOk({ ...snapshot, cached: false });
}
