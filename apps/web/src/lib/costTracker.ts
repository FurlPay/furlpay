// ---------------------------------------------------------------------------
// Infra cost tracking — every metered external call records its estimated
// cost so the monthly burn per provider is visible from day one (the
// cloud-native cost-optimization pattern; Vanguard credits it with a 30%
// infra saving at scale).
//
// Design: fire-and-forget. `trackCost` never throws and never awaits in the
// caller's hot path — a KV outage must not slow down or fail an email send or
// a copilot reply. Amounts are stored as integer micro-dollars (kvIncrBy is
// integer-only), bucketed per service per UTC month, and expire after ~100
// days so the ledger self-cleans.
// ---------------------------------------------------------------------------

import { kvGet, kvIncr, kvIncrBy } from "./kv";

export type CostService =
  | "resend" // transactional email
  | "anthropic" // copilot LLM phrasing
  | "helius" // Solana RPC / DAS / webhooks
  | "supabase" // durable store
  | "upstash" // Redis KV
  | "sumsub" // KYC checks
  | "lifi" // swap/bridge aggregation
  | "duffel"; // travel search/booking

export const COST_SERVICES: CostService[] = [
  "resend",
  "anthropic",
  "helius",
  "supabase",
  "upstash",
  "sumsub",
  "lifi",
  "duffel",
];

// Estimated unit costs in micro-dollars (1e-6 USD), from each provider's
// published pricing at typical tiers. These are estimates for trend/alerting,
// not invoices — reconcile against provider dashboards monthly.
const UNIT_COST_MICROS: Record<string, number> = {
  "resend:email": 400, // ~$20 / 50k emails
  "anthropic:copilot_message": 2_000, // Haiku, ~600 tokens/turn
  "helius:rpc": 10,
  "helius:das": 25,
  "helius:webhook": 100,
  "supabase:query": 1,
  "upstash:command": 2,
  "sumsub:kyc_check": 1_500_000, // ~$1.50 per applicant check
  "lifi:quote": 0, // free; the integrator fee is revenue, not cost
  "duffel:search": 5_000,
};

const KEY_TTL_SECONDS = 100 * 86_400; // outlives the month, then self-cleans
const month = () => new Date().toISOString().slice(0, 7); // "2026-07"

const spendKey = (m: string, s: CostService) => `costs:spend:${m}:${s}`;
const callsKey = (m: string, s: CostService) => `costs:calls:${m}:${s}`;

/** Record one (or `count`) metered calls to an external service.
 *  Fire-and-forget: returns immediately, swallows every error. */
export function trackCost(service: CostService, operation: string, count = 1): void {
  const micros = (UNIT_COST_MICROS[`${service}:${operation}`] ?? 100) * count;
  const m = month();
  void Promise.all([
    micros > 0 ? kvIncrBy(spendKey(m, service), micros, KEY_TTL_SECONDS) : Promise.resolve(0),
    kvIncr(callsKey(m, service), KEY_TTL_SECONDS),
  ]).catch(() => {
    /* cost telemetry must never take a feature down */
  });
}

export interface ServiceCost {
  service: CostService;
  calls: number;
  estimatedUsd: number;
}

export interface MonthlyCosts {
  month: string; // "YYYY-MM"
  services: ServiceCost[];
  totalUsd: number;
  note: string;
}

/** Aggregate the month's estimated spend across all tracked services. */
export async function getMonthlyCosts(m = month()): Promise<MonthlyCosts> {
  const services = await Promise.all(
    COST_SERVICES.map(async (service) => {
      const [micros, calls] = await Promise.all([
        kvGet<number>(spendKey(m, service)),
        kvGet<number>(callsKey(m, service)),
      ]);
      return {
        service,
        calls: Number(calls ?? 0),
        estimatedUsd: Math.round(Number(micros ?? 0) / 10_000) / 100,
      };
    })
  );
  const active = services.filter((s) => s.calls > 0 || s.estimatedUsd > 0);
  return {
    month: m,
    services: active,
    totalUsd: Math.round(active.reduce((sum, s) => sum + s.estimatedUsd, 0) * 100) / 100,
    note: "Estimated from published unit prices — reconcile against provider dashboards.",
  };
}
