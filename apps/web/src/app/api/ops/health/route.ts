import { NextRequest } from "next/server";
import { createPublicClient } from "viem";
import { requireOpsAdmin, opsOk } from "@/lib/ops/respond";
import { kvGet, kvSet } from "@/lib/kv";
import { sbSelect, supabaseBackend } from "@/lib/supabase";
import { auditFlushStats } from "@/lib/auditDb";
import { probeRequiredConstraints } from "@/lib/ops/schemaProbe";
import { buildInfo } from "@/lib/ops/buildInfo";
import { EVM_CHAINS, rpcTransport } from "@/lib/x402Chains";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/ops/health — component-level dependency probes.
// Each probe is a real round-trip with a hard timeout; results are cached in
// KV for 30s so dashboard polling never becomes a probe storm against
// third-party services. Probes that need credentials the deployment doesn't
// have report "not_configured" rather than a fake status.
// ---------------------------------------------------------------------------

// "unverified" exists for the schema probe: a check that could not RUN is not
// a check that passed, and collapsing the two would turn an unknown into a
// false assurance on the question the probe was added to answer.
type CheckStatus = "operational" | "degraded" | "down" | "not_configured" | "unverified";
interface Check {
  status: CheckStatus;
  latencyMs?: number;
  blockNumber?: number;
  detail?: string;
  /** Schema probe only: which required constraints are absent. */
  missing?: { constraint: string; table: string; purpose: string }[];
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
  // `schema` is critical: a missing constraint is not a slow dependency that
  // will recover on its own, it is a correctness guarantee that is absent now
  // and stays absent until someone applies a migration.
  const critical = ["redis", "supabase", "arbitrum_rpc", "schema"];
  if (critical.some((k) => checks[k]?.status === "down")) return "unhealthy";
  const active = Object.values(checks).filter((c) => c.status !== "not_configured");
  // "unverified" degrades rather than fails: it means we do not know, which
  // must be visible on the dashboard but is not itself evidence of a fault.
  if (active.some((c) => c.status === "down" || c.status === "degraded" || c.status === "unverified"))
    return "degraded";
  return "healthy";
}

/** Audit-trail counters for the serving instance. Deliberately NOT cached:
 *  these are per-lambda, so a cached copy would describe a different process. */
function auditSnapshot() {
  const audit = auditFlushStats();
  return {
    ...audit,
    // Per-instance: read a non-zero value as "at least this many", never as a
    // global total. A hole in the trail is still a hole.
    status: audit.failed > 0 || audit.dropped > 0 ? "degraded" : "ok",
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;

  const cached = await kvGet<object>(CACHE_KEY);
  // Dependency probes are shared and cacheable; audit counters are NOT — they
  // live in this lambda's memory. Serving a cached copy would report some
  // other instance's counters, so they are always recomputed locally and
  // overwrite whatever the cached snapshot carried.
  if (cached) return opsOk({ ...cached, audit: auditSnapshot(), cached: true });

  const iris = process.env.CCTP_IRIS_API_URL || "https://iris-api.circle.com";
  const [redis, supabase, arbitrum, base, irisCheck, lifi, schema] = await Promise.all([
    probeRedis(),
    probeSupabase(),
    probeRpc("arbitrum"),
    probeRpc("base"),
    probeHttp(`${iris}/v2/burn/USDC/fees/3/3`),
    probeHttp("https://li.quest/v1/chains"),
    // Not wrapped in timed(): this asserts a fact about the schema, and a
    // latency number would invite reading it as a dependency probe.
    probeRequiredConstraints(),
  ]);

  const checks: Record<string, Check> = {
    redis,
    supabase,
    arbitrum_rpc: arbitrum,
    base_rpc: base,
    cctp_iris: irisCheck,
    lifi_api: lifi,
    schema,
  };

  const snapshot = {
    status: rollup(checks),
    timestamp: new Date().toISOString(),
    // Kept for dashboards that already read `version`; `build` below is the full
    // provenance block. VERCEL_GIT_COMMIT_SHA is set only for git-integration
    // deploys; manual `vercel deploy` CLI runs (FurlPay's ship path) do NOT set
    // it, so this reported "dev" and the deployed commit was unprovable. See
    // docs/operations/RELEASE_PROVENANCE.md.
    version:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
      process.env.FURLPAY_BUILD_SHA?.slice(0, 7) ??
      "dev",
    // Full deployment provenance for authenticated operators. Every value degrades
    // to "unknown" rather than crashing, and NONE of these are secrets (a commit
    // SHA, a branch name and a build id are all safe to show an ops admin).
    build: buildInfo(),
    checks,
    // A failed or dropped entry means the compliance record has a HOLE, which
    // no upstream probe detects — Postgres is up, the action succeeded, and
    // only the evidence is missing. Alertable rather than sitting in a counter
    // nobody reads.
    audit: auditSnapshot(),
  };
  await kvSet(CACHE_KEY, snapshot, CACHE_TTL_S);
  return opsOk({ ...snapshot, cached: false });
}
