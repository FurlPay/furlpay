import { z } from "zod";

// ---------------------------------------------------------------------------
// Allium Explorer API, server-side only. Verified against docs.allium.so
// (Explorer API → "Programmatic query workflow", "Fetch latest query run",
// "Fetch query run results"):
//
//   base      https://api.allium.so
//   auth      X-API-KEY header
//   latest    GET  /api/v1/explorer/query-runs?query_id=<id>
//   results   GET  /api/v1/explorer/query-runs/<run_id>/results  → { data, meta, queried_at }
//   run       POST /api/v1/explorer/queries/<id>/run-async       → { run_id }
//
// The Explorer API runs SAVED queries only (no ad-hoc SQL), so FurlPay reads
// the latest finished run of queries the operator saves in the Allium app and
// names in env. Their SQL is the operator's; the CONTRACT is the output
// columns below, validated row by row. A query that is missing, failing,
// stale or shaped differently is reported as unavailable with the reason —
// never replaced with a guess.
//
// A stale result triggers a fresh run-async (at most once an hour per
// instance) and the previous finished run keeps being served meanwhile, so a
// dashboard poll never waits on a warehouse.
// ---------------------------------------------------------------------------

export type Sourced<T> =
  | { status: "ok"; data: T; asOf: string; source: string }
  | { status: "unavailable"; reason: string; source: string };

const BASE = "https://api.allium.so";
const TIMEOUT_MS = 8_000;
const STALE_MS = 26 * 3_600_000; // a daily query that missed one day is stale
const RERUN_COOLDOWN_MS = 3_600_000;
const MEMO_MS = 5 * 60_000;

const n = z.coerce.number().finite().nonnegative();

// Output contracts of the SAVED Explorer queries. Column names follow
// stablecoins.metrics.volume_daily (one row per chain x day x token; clustered
// on activity_date, chain), aggregated per day / per chain by the saved SQL.
// Reference SQL is in docs/ALLIUM_INTEGRATION.md.
export const ALLIUM_QUERIES = {
  stablecoinDaily: {
    env: "ALLIUM_STABLECOIN_DAILY_QUERY_ID",
    label: "stablecoin daily metrics",
    columns: "day, tx_count, transfer_count, volume_usd, sender_count, recipient_count",
    row: z.object({
      day: z.string().min(8),
      tx_count: n,
      transfer_count: n,
      volume_usd: n,
      sender_count: n,
      recipient_count: n,
    }),
  },
  // Tokenized assets, same columns as the CSV export, so a daily refresh and
  // the bootstrap file share one model. Cast market_cap_usd to varchar in the
  // SQL to keep full precision (a JSON number is a float).
  rwaAssets: {
    env: "ALLIUM_RWA_QUERY_ID",
    label: "tokenized assets",
    columns: "product_name, token_symbol, chain, issuer_name, asset_class, asset_type, market_cap_usd",
    row: z.object({
      product_name: z.string().trim().min(1).max(200),
      token_symbol: z.string().trim().max(64).nullish().transform((v) => v ?? ""),
      chain: z.string().regex(/^[a-z0-9_-]{2,32}$/),
      issuer_name: z.string().trim().min(1).max(200),
      asset_class: z.string().regex(/^[a-z_]{2,40}$/),
      asset_type: z.string().regex(/^[a-z0-9_]{2,60}$/),
      market_cap_usd: z.union([z.string(), z.number().finite().nonnegative()]).transform((v) => String(v)),
    }),
  },
  stablecoinByChain: {
    env: "ALLIUM_STABLECOIN_CHAIN_QUERY_ID",
    label: "stablecoin volume by chain",
    columns: "chain, volume_usd_latest_day, volume_usd_prior_7d_avg [, tx_count_latest_day]",
    row: z.object({
      chain: z.string().regex(/^[a-z0-9_-]{2,32}$/),
      volume_usd_latest_day: n,
      volume_usd_prior_7d_avg: n,
      tx_count_latest_day: n.nullish(),
    }),
  },
  corridors: {
    env: "ALLIUM_CORRIDOR_QUERY_ID",
    label: "stablecoin corridors",
    columns: "from_country, to_country, volume_usd (ISO-3166 alpha-2 codes)",
    row: z.object({
      from_country: z.string().regex(/^[A-Z]{2}$/),
      to_country: z.string().regex(/^[A-Z]{2}$/),
      volume_usd: z.coerce.number().finite().nonnegative(),
    }),
  },
} as const;

export type AlliumQueryName = keyof typeof ALLIUM_QUERIES;
export type AlliumRow<K extends AlliumQueryName> = z.infer<(typeof ALLIUM_QUERIES)[K]["row"]>;

export function alliumKeyConfigured(): boolean {
  return (process.env.ALLIUM_API_KEY ?? "").trim().length > 0;
}

const latestRun = z.object({
  run_id: z.string().min(1),
  status: z.enum(["created", "queued", "running", "success", "failed", "canceled"]),
  completed_at: z.string().nullish(),
  error: z.string().nullish(),
});
const results = z.object({ data: z.array(z.unknown()), queried_at: z.string().nullish() });

class AlliumHttpError extends Error {}

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const key = (process.env.ALLIUM_API_KEY ?? "").trim();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "X-API-KEY": key, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    // Status only: the body can echo request details and is never logged or returned.
    const hint = res.status === 401 || res.status === 403 ? " (check ALLIUM_API_KEY)" : res.status === 429 ? " (rate limited)" : "";
    throw new AlliumHttpError(`Allium responded ${res.status}${hint}`);
  }
  return res.json();
}

const memo = new Map<string, { at: number; value: Sourced<unknown[]> }>();
const lastRerun = new Map<string, number>();

/** Test hook. */
export function __resetAlliumMemo() {
  memo.clear();
  lastRerun.clear();
}

/**
 * Rows of the latest successful run of a configured saved query, validated
 * against its output contract.
 */
export async function alliumQuery<K extends AlliumQueryName>(name: K, now = Date.now()): Promise<Sourced<AlliumRow<K>[]>> {
  const spec = ALLIUM_QUERIES[name];
  const source = `Allium Explorer (${spec.label})`;
  if (!alliumKeyConfigured()) return { status: "unavailable", reason: "ALLIUM_API_KEY is not set.", source };
  const queryId = (process.env[spec.env] ?? "").trim();
  if (!queryId) return { status: "unavailable", reason: `${spec.env} is not set: save a query in Allium returning ${spec.columns}.`, source };
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(queryId)) return { status: "unavailable", reason: `${spec.env} is not a valid query id.`, source };

  const hit = memo.get(name);
  if (hit && now - hit.at < MEMO_MS) return hit.value as Sourced<AlliumRow<K>[]>;

  let value: Sourced<AlliumRow<K>[]>;
  try {
    const run = latestRun.safeParse(await call(`/api/v1/explorer/query-runs?query_id=${encodeURIComponent(queryId)}`));
    if (!run.success) throw new Error("unexpected latest-run response shape");
    const done = run.data.status === "success" && run.data.completed_at ? Date.parse(run.data.completed_at) : NaN;
    const stale = !Number.isFinite(done) || now - done > STALE_MS;
    const idle = !["created", "queued", "running"].includes(run.data.status);
    if (stale && idle && now - (lastRerun.get(name) ?? 0) > RERUN_COOLDOWN_MS) {
      lastRerun.set(name, now);
      // Fire and forget: the next poll after it finishes serves the new run.
      void call(`/api/v1/explorer/queries/${encodeURIComponent(queryId)}/run-async`, { method: "POST", body: "{}" }).catch(() => {});
    }
    if (run.data.status !== "success") {
      value = { status: "unavailable", reason: `Latest Allium run is ${run.data.status}${run.data.error ? `: ${run.data.error.slice(0, 120)}` : ""}.`, source };
    } else {
      const body = results.safeParse(await call(`/api/v1/explorer/query-runs/${encodeURIComponent(run.data.run_id)}/results`));
      if (!body.success) throw new Error("unexpected results response shape");
      const rows: AlliumRow<K>[] = [];
      for (const raw of body.data.data) {
        const r = (spec.row as z.ZodType<AlliumRow<K>>).safeParse(raw);
        if (!r.success) {
          value = { status: "unavailable", reason: `Allium query output does not match the contract (${spec.columns}).`, source };
          memo.set(name, { at: now, value: value as Sourced<unknown[]> });
          return value;
        }
        rows.push(r.data);
      }
      value = { status: "ok", data: rows, asOf: body.data.queried_at ?? run.data.completed_at ?? new Date(done).toISOString(), source };
      if (stale) value = { ...value, source: `${source}, last run older than 26h; refresh requested` };
    }
  } catch (e) {
    const reason = e instanceof Error && e.name === "TimeoutError" ? "Allium did not answer within 8s." : e instanceof Error ? e.message.slice(0, 160) : "Allium request failed.";
    value = { status: "unavailable", reason, source };
  }
  memo.set(name, { at: now, value: value as Sourced<unknown[]> });
  return value;
}
