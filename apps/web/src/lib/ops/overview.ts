import { kvGet } from "@/lib/kv";
import { controlSnapshot, RAILS, type Rail, type PauseState } from "@/lib/ops/controls";

// ---------------------------------------------------------------------------
// Overview aggregation — reads the REAL ops counters (ops:count:*) and control
// state. No fabricated metrics: a rail with no traffic reports zeros, and a
// rail without its production credentials reports NOT_CONFIGURED / armed:false.
// ---------------------------------------------------------------------------

export type RailStatus = "HEALTHY" | "DEGRADED" | "INCIDENT" | "PAUSED" | "NOT_CONFIGURED";

/** Whether real settlement can actually fire (not just run in mock). */
function x402Armed(): boolean {
  const live = process.env.INTEGRATION_MODE === "live" || process.env.X402_ENFORCE_SIGNATURE === "1";
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

const STATES = ["settled", "pending", "failed", "rejected"] as const;

async function num(key: string): Promise<number> {
  return (await kvGet<number>(key)) ?? 0;
}

async function railMetrics(rail: Rail) {
  const counts = Object.fromEntries(
    await Promise.all(STATES.map(async (s) => [s, await num(`ops:count:tx:${rail}:${s}`)] as const))
  ) as Record<(typeof STATES)[number], number>;
  const total = STATES.reduce((s, k) => s + counts[k], 0);
  const volumeUsd = (await num(`ops:count:vol:${rail}`)) / 100;
  const feeUsd = (await num(`ops:count:fee:${rail}`)) / 100;
  const successRate = total > 0 ? counts.settled / total : null;
  return { total, ...counts, volumeUsd, feeUsd, successRate };
}

function railStatus(pause: PauseState, globalPaused: boolean): RailStatus {
  if (globalPaused || pause.paused) return "PAUSED";
  // The four live rails run keyless in dev; `armed` (surfaced separately) is
  // what tells the UI whether REAL money can move. We don't fabricate
  // DEGRADED/INCIDENT — those come from real health signals only.
  return "HEALTHY";
}

export async function opsOverview() {
  const controls = await controlSnapshot();
  const cfg = configReadiness();
  const armedByRail: Record<Rail, boolean> = {
    x402: cfg.x402.armed, mpp: cfg.x402.armed, lifi: cfg.lifi.armed, cctp: cfg.cctp.armed, transfers: false,
  };

  const rails = await Promise.all(
    RAILS.map(async (rail) => ({
      rail,
      status: rail === "transfers" ? ("NOT_CONFIGURED" as RailStatus) : railStatus(controls.rails[rail], controls.global.paused),
      armed: armedByRail[rail],
      ...(await railMetrics(rail)),
    }))
  );

  const totals = rails.reduce(
    (acc, r) => ({
      volumeUsd: acc.volumeUsd + r.volumeUsd,
      feeUsd: acc.feeUsd + r.feeUsd,
      transactions: acc.transactions + r.total,
      settled: acc.settled + r.settled,
      pending: acc.pending + r.pending,
      failed: acc.failed + r.failed,
    }),
    { volumeUsd: 0, feeUsd: 0, transactions: 0, settled: 0, pending: 0, failed: 0 }
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
      successRate: totals.transactions > 0 ? totals.settled / totals.transactions : null,
    },
    rails,
    futureRails,
    config: cfg,
  };
}
