import { kvGet, kvSet } from "@/lib/kv";
import { signatureEnforced } from "@/lib/x402Enforcement";
import { controlSnapshot, RAILS, type Rail, type PauseState } from "@/lib/ops/controls";

// ---------------------------------------------------------------------------
// Overview aggregation — reads the REAL ops counters (ops:count:*) and control
// state. No fabricated metrics: a rail with no traffic reports zeros, and a
// rail without its production credentials reports NOT_CONFIGURED / armed:false.
// ---------------------------------------------------------------------------

export type RailStatus = "HEALTHY" | "DEGRADED" | "INCIDENT" | "PAUSED" | "NOT_CONFIGURED" | "UNKNOWN";
type ActiveRailStatus = Exclude<RailStatus, "PAUSED" | "NOT_CONFIGURED" | "UNKNOWN">;

interface RailHealthSignal {
  status: ActiveRailStatus;
  checkedAt: string;
  latencyMs?: number;
  detail?: string;
}

const HEALTH_FRESH_MS = 2 * 60_000;
const healthKey = (rail: Rail) => `ops:health:rail:${rail}`;

export async function recordRailHealth(
  rail: Rail,
  status: ActiveRailStatus,
  detail?: string,
  latencyMs?: number
): Promise<void> {
  const signal: RailHealthSignal = { status, checkedAt: new Date().toISOString(), detail, latencyMs };
  try {
    await kvSet(healthKey(rail), signal, Math.ceil(HEALTH_FRESH_MS / 1000));
  } catch {
    /* health telemetry must not fail the money route that produced it */
  }
}

/** Whether real settlement can actually fire (not just run in mock). */
function x402Armed(): boolean {
  // Reported from the SINGLE enforcement authority rather than re-deriving the
  // rule, so the ops console can never show a posture the facilitator is not
  // actually applying.
  const live = signatureEnforced();
  return live && !!process.env.FACILITATOR_EVM_PRIVATE_KEY && !!process.env.ARBITRUM_RPC_URL;
}

/** Env presence check — booleans only, never values (spec: never expose keys). */
export function configReadiness() {
  return {
    x402: {
      INTEGRATION_MODE: process.env.INTEGRATION_MODE === "live",
      FACILITATOR_EVM_PRIVATE_KEY: !!process.env.FACILITATOR_EVM_PRIVATE_KEY,
      ARBITRUM_RPC_URL: !!process.env.ARBITRUM_RPC_URL,
      ARBITRUM_RPC_URL_FALLBACK: !!process.env.ARBITRUM_RPC_URL_FALLBACK,
      X402_QUOTE_SECRET: !!process.env.X402_QUOTE_SECRET,
      armed: x402Armed(),
    },
    lifi: {
      LIFI_API_KEY: !!process.env.LIFI_API_KEY,
      LIFI_INTEGRATOR: process.env.LIFI_INTEGRATOR || "furlpay",
      LIFI_FEE: process.env.LIFI_FEE || null,
      armed: !!process.env.LIFI_API_KEY,
    },
    cctp: {
      IRIS_API: process.env.CCTP_IRIS_API_URL || "https://iris-api.circle.com",
      testnet: process.env.CCTP_TESTNET === "1",
      armed: true, // public Iris + on-chain contracts; non-custodial calldata
    },
    limits: {
      maxSwapUsd: Number(process.env.FURLPAY_MAX_SWAP_USD || 500),
      maxCctpUsd: Number(process.env.FURLPAY_MAX_CCTP_USD || 500),
    },
    providers: {
      redis: (process.env.REDIS_URL || process.env.KV_REST_API_URL) ? true : false,
      supabase: !!process.env.SUPABASE_URL,
      helius: !!process.env.HELIUS_API_KEY,
      resend: !!process.env.RESEND_API_KEY,
      bridge: !!process.env.BRIDGE_API_KEY,
      stripeIssuing: !!process.env.STRIPE_ISSUING_KEY,
    },
  };
}

const STATES = ["prepared", "settled", "pending", "failed", "rejected"] as const;

async function num(key: string): Promise<number> {
  return (await kvGet<number>(key)) ?? 0;
}

async function railMetrics(rail: Rail) {
  const counts = Object.fromEntries(
    await Promise.all(STATES.map(async (s) => [s, await num(`ops:count:tx:${rail}:${s}`)] as const))
  ) as Record<(typeof STATES)[number], number>;
  const total = STATES.reduce((s, k) => s + counts[k], 0);
  const attempted = total - counts.prepared;
  const volumeUsd = (await num(`ops:count:vol:${rail}`)) / 100;
  const feeUsd = (await num(`ops:count:fee:${rail}`)) / 100;
  const successRate = attempted > 0 ? counts.settled / attempted : null;
  return { total, attempted, ...counts, volumeUsd, feeUsd, successRate };
}

async function recentRailHealth(rail: Rail): Promise<RailHealthSignal | null> {
  const signal = await kvGet<RailHealthSignal>(healthKey(rail));
  if (!signal?.checkedAt) return null;
  const checkedAt = Date.parse(signal.checkedAt);
  if (!Number.isFinite(checkedAt) || Date.now() - checkedAt > HEALTH_FRESH_MS) return null;
  return signal;
}

function railStatus(armed: boolean, pause: PauseState, globalPaused: boolean, health: RailHealthSignal | null): RailStatus {
  if (globalPaused || pause.paused) return "PAUSED";
  if (!armed) return "NOT_CONFIGURED";
  return health?.status ?? "UNKNOWN";
}

/** Public-safe operational status per rail: pause state + freshness-bounded
 *  health only — no env presence, no volumes (those stay admin-gated). */
export async function publicRailStatuses(): Promise<Record<Rail, RailStatus>> {
  const controls = await controlSnapshot();
  const cfg = configReadiness();
  const armed: Record<Rail, boolean> = {
    x402: cfg.x402.armed, mpp: cfg.x402.armed, lifi: cfg.lifi.armed, cctp: cfg.cctp.armed, transfers: cfg.x402.armed,
  };
  const out = {} as Record<Rail, RailStatus>;
  for (const rail of RAILS) {
    const health = await recentRailHealth(rail);
    out[rail] = railStatus(armed[rail], controls.rails[rail], controls.global.paused, health);
  }
  return out;
}

export async function opsOverview() {
  const controls = await controlSnapshot();
  const cfg = configReadiness();
  const armedByRail: Record<Rail, boolean> = {
    // Gasless transfers relay through the same fee-payer/settler as x402.
    x402: cfg.x402.armed, mpp: cfg.x402.armed, lifi: cfg.lifi.armed, cctp: cfg.cctp.armed, transfers: cfg.x402.armed,
  };

  const rails = await Promise.all(
    RAILS.map(async (rail) => {
      const health = await recentRailHealth(rail);
      return {
        rail,
        status: railStatus(armedByRail[rail], controls.rails[rail], controls.global.paused, health),
        armed: armedByRail[rail],
        control: controls.rails[rail],
        health,
        ...(await railMetrics(rail)),
      };
    })
  );

  const totals = rails.reduce(
    (acc, r) => ({
      volumeUsd: acc.volumeUsd + r.volumeUsd,
      feeUsd: acc.feeUsd + r.feeUsd,
      transactions: acc.transactions + r.total,
      settled: acc.settled + r.settled,
      pending: acc.pending + r.pending,
      failed: acc.failed + r.failed,
      prepared: acc.prepared + r.prepared,
      attempted: acc.attempted + r.attempted,
    }),
    { volumeUsd: 0, feeUsd: 0, transactions: 0, settled: 0, pending: 0, failed: 0, prepared: 0, attempted: 0 }
  );

  // Non-configured future rails, shown for completeness.
  const futureRails = [
    { rail: "bridge", status: "NOT_CONFIGURED" as RailStatus, armed: false },
    { rail: "cards", status: "NOT_CONFIGURED" as RailStatus, armed: false },
  ];

  return {
    globalPaused: controls.global.paused,
    globalPause: controls.global,
    totals: {
      ...totals,
      successRate: totals.attempted > 0 ? totals.settled / totals.attempted : null,
    },
    rails,
    futureRails,
    config: cfg,
  };
}
