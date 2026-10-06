import { z } from "zod";
import type { Sourced } from "./allium";

// ---------------------------------------------------------------------------
// Global stablecoin market from DefiLlama's public stablecoin API (keyless):
//
//   https://stablecoins.llama.fi/stablecoins?includePrices=true
//       peggedAssets[]: symbol, name, pegType, circulating.peggedUSD,
//       circulatingPrevMonth.peggedUSD, chainCirculating[chain].current.peggedUSD
//   https://stablecoins.llama.fi/stablecoincharts/all
//       [{ date (unix s), totalCirculatingUSD: { peggedUSD, … } }]
//
// USD-pegged supply only (pegType "peggedUSD"), so a EUR or gold-backed
// token is never summed as dollars. Responses go through Next's data cache
// for 30 minutes; a failure is reported, not papered over.
// ---------------------------------------------------------------------------

const SOURCE = "DefiLlama stablecoins API";
const TIMEOUT_MS = 10_000;
const REVALIDATE_S = 1_800;

const usd = z.object({ peggedUSD: z.number().finite().nonnegative().optional() }).partial().nullish();
const assets = z.object({
  peggedAssets: z.array(
    z.object({
      symbol: z.string(),
      name: z.string(),
      pegType: z.string(),
      circulating: usd,
      circulatingPrevMonth: usd,
      chainCirculating: z.record(z.object({ current: usd }).passthrough()).nullish(),
    })
  ),
});
const chart = z.array(z.object({ date: z.union([z.string(), z.number()]), totalCirculatingUSD: usd }));

export interface StablecoinMarket {
  totalSupplyUsd: number;
  supplyChange30d: number | null; // ratio
  topCoins: { symbol: string; name: string; supplyUsd: number; share: number }[];
  topChains: { chain: string; supplyUsd: number; share: number }[];
  /** Daily total USD-pegged supply, oldest first, last 90 days. */
  supplySeries: { date: string; value: number }[];
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), next: { revalidate: REVALIDATE_S } });
  if (!res.ok) throw new Error(`${SOURCE} responded ${res.status}`);
  return res.json();
}

export function summarizeMarket(rawAssets: unknown, rawChart: unknown): StablecoinMarket {
  const a = assets.parse(rawAssets);
  const usdCoins = a.peggedAssets.filter((x) => x.pegType === "peggedUSD" && (x.circulating?.peggedUSD ?? 0) > 0);
  const total = usdCoins.reduce((s, x) => s + (x.circulating?.peggedUSD ?? 0), 0);
  if (!(total > 0)) throw new Error(`${SOURCE} returned no USD-pegged supply`);
  const prevMonth = usdCoins.reduce((s, x) => s + (x.circulatingPrevMonth?.peggedUSD ?? 0), 0);

  const byChain = new Map<string, number>();
  for (const c of usdCoins) {
    for (const [chain, v] of Object.entries(c.chainCirculating ?? {})) {
      const amt = v.current?.peggedUSD ?? 0;
      if (amt > 0) byChain.set(chain, (byChain.get(chain) ?? 0) + amt);
    }
  }

  const series = chart
    .parse(rawChart)
    .map((p) => ({ t: Number(p.date) * 1000, v: p.totalCirculatingUSD?.peggedUSD ?? 0 }))
    .filter((p) => Number.isFinite(p.t) && p.v > 0)
    .sort((x, y) => x.t - y.t)
    .slice(-90)
    .map((p) => ({ date: new Date(p.t).toISOString().slice(0, 10), value: p.v }));

  return {
    totalSupplyUsd: total,
    supplyChange30d: prevMonth > 0 ? (total - prevMonth) / prevMonth : null,
    topCoins: usdCoins
      .map((c) => ({ symbol: c.symbol, name: c.name, supplyUsd: c.circulating?.peggedUSD ?? 0, share: (c.circulating?.peggedUSD ?? 0) / total }))
      .sort((x, y) => y.supplyUsd - x.supplyUsd)
      .slice(0, 6),
    topChains: [...byChain.entries()]
      .map(([chain, supplyUsd]) => ({ chain, supplyUsd, share: supplyUsd / total }))
      .sort((x, y) => y.supplyUsd - x.supplyUsd)
      .slice(0, 6),
    supplySeries: series,
  };
}

export async function stablecoinMarket(): Promise<Sourced<StablecoinMarket>> {
  try {
    const [rawAssets, rawChart] = await Promise.all([
      getJson("https://stablecoins.llama.fi/stablecoins?includePrices=true"),
      getJson("https://stablecoins.llama.fi/stablecoincharts/all"),
    ]);
    return { status: "ok", data: summarizeMarket(rawAssets, rawChart), asOf: new Date().toISOString(), source: SOURCE };
  } catch (e) {
    const reason = e instanceof Error && e.name === "TimeoutError" ? `${SOURCE} did not answer within 10s.` : e instanceof z.ZodError ? `${SOURCE} changed its response shape.` : e instanceof Error ? e.message.slice(0, 160) : "request failed";
    return { status: "unavailable", reason, source: SOURCE };
  }
}
