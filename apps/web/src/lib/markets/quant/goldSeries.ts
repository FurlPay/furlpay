// ---------------------------------------------------------------------------
// The gold data layer: what we can actually observe, and what we cannot.
//
// ── THERE IS NO SPOT GOLD IN THIS PIPELINE ─────────────────────────────────
//
// Our provider does not carry spot XAUUSD; the request 404s. What it carries is
// GC=F, the COMEX front-month future, and GLD, a trust whose share is a
// fraction of an ounce. Neither is spot, and the differences are not rounding:
//
//   futures = spot + carry           (rates, storage, time to expiry)
//   GLD share = ounces per share × spot, net of accrued fees
//
// So `SeriesKind` names what each series IS. Nothing in this file is labelled
// "spot", and `basis` is computed and reported rather than assumed away. When a
// caller wants a spot number, the honest answer is that we do not have one.
//
// ── WHY THE MACRO SET STOPS WHERE IT DOES ──────────────────────────────────
//
// FRED serves daily series without a key, which covers the variables that
// actually drive gold's opportunity cost: the 10-year real yield, nominals, the
// trade-weighted dollar and breakeven inflation. Those series are NOT revised,
// so reading today's file and using a value dated 2019-03-04 gives exactly what
// was published on 2019-03-04.
//
// CPI, PCE and payrolls ARE revised, sometimes substantially and sometimes
// years later. `fredgraph.csv` returns the current vintage, so a backtest that
// reads today's CPI series and applies it to 2019 is trading on numbers nobody
// had. Getting this right needs ALFRED vintages, which need an API key this
// deployment does not have. Rather than approximate it, revised monthly macro
// is EXCLUDED from the feature set and this comment records why. A model built
// on look-ahead data does not fail loudly; it produces excellent backtests and
// loses money.
// ---------------------------------------------------------------------------

import { cachedJson, BROWSER_UA } from "../providers/cache";
import type { Bar } from "./features";

const CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv";

/** Six hours: these are daily series and a re-fetch mid-session gains nothing
 *  but load on two free providers. */
const TTL_SERIES = 21_600;

export type SeriesKind =
  /** A dated futures contract. Carries basis; is not spot. */
  | "frontMonthFuture"
  /** An exchange-traded trust holding the metal, net of fees. */
  | "etfProxy"
  /** A market index or rate, not a tradable price. */
  | "reference";

export interface PriceSeries {
  symbol: string;
  providerSymbol: string;
  kind: SeriesKind;
  bars: Bar[];
  /** Why this series is not the thing a reader may think it is. */
  note: string;
}

/** Daily bars from the chart provider, oldest first, gaps dropped rather than
 *  interpolated — an invented bar becomes an invented return. */
async function fetchBars(providerSymbol: string, range = "10y"): Promise<Bar[]> {
  const raw = await cachedJson<Bar[]>(
    `quant:bars:v1:${providerSymbol}:${range}`,
    TTL_SERIES,
    async () => {
      try {
        const res = await fetch(
          `${CHART}/${encodeURIComponent(providerSymbol)}?range=${range}&interval=1d`,
          { headers: BROWSER_UA, signal: AbortSignal.timeout(20_000), cache: "no-store" }
        );
        if (!res.ok) return null;
        const j = (await res.json()) as {
          chart?: {
            result?: {
              timestamp?: number[];
              indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] };
            }[];
          };
        };
        const r = j.chart?.result?.[0];
        const ts = r?.timestamp ?? [];
        const q = r?.indicators?.quote?.[0];
        if (!q) return null;
        const out: Bar[] = [];
        for (let i = 0; i < ts.length; i++) {
          const c = q.close?.[i];
          const o = q.open?.[i];
          const h = q.high?.[i];
          const l = q.low?.[i];
          // A bar missing any of OHLC is dropped. Carrying the previous close
          // forward would manufacture a zero-return day that never happened.
          if (c == null || o == null || h == null || l == null) continue;
          out.push({
            date: new Date(ts[i]! * 1000).toISOString().slice(0, 10),
            open: o, high: h, low: l, close: c,
            volume: q.volume?.[i] ?? null,
          });
        }
        return out;
      } catch {
        return null;
      }
    }
  );
  return raw ?? [];
}

/** One observation of a macro or rate series, dated by OBSERVATION date. */
export interface MacroPoint {
  date: string;
  value: number;
}

/**
 * A daily FRED series, parsed from the keyless CSV.
 *
 * Only series that are NOT revised belong here. See the header: reading a
 * revised series at today's vintage and applying it historically is
 * look-ahead bias, and it is invisible in results.
 */
async function fetchFred(id: string): Promise<MacroPoint[]> {
  const raw = await cachedJson<MacroPoint[]>(
    `quant:fred:v1:${id}`,
    TTL_SERIES,
    async () => {
      try {
        const res = await fetch(`${FRED}?id=${encodeURIComponent(id)}`, {
          headers: BROWSER_UA,
          signal: AbortSignal.timeout(20_000),
          cache: "no-store",
        });
        if (!res.ok) return null;
        const text = await res.text();
        const out: MacroPoint[] = [];
        const lines = text.trim().split("\n");
        for (let i = 1; i < lines.length; i++) {
          const [date, v] = lines[i]!.split(",");
          if (!date) continue;
          // FRED writes "." for a non-trading day. It is missing, not zero.
          const value = Number(v);
          if (!v || v === "." || !Number.isFinite(value)) continue;
          out.push({ date: date.trim(), value });
        }
        return out;
      } catch {
        return null;
      }
    }
  );
  return raw ?? [];
}

/** Every price series this engine reads, with what each one actually is. */
export const GOLD_SERIES = {
  goldFuture: {
    symbol: "XAUUSD",
    providerSymbol: "GC=F",
    kind: "frontMonthFuture" as SeriesKind,
    note: "COMEX front-month gold future. Includes carry; not spot XAUUSD.",
  },
  goldEtf: {
    symbol: "GLD",
    providerSymbol: "GLD",
    kind: "etfProxy" as SeriesKind,
    note: "SPDR Gold Shares. A share is a fraction of an ounce, net of accrued fees; not spot and not comparable to a futures price without scaling.",
  },
  silverFuture: {
    symbol: "XAGUSD",
    providerSymbol: "SI=F",
    kind: "frontMonthFuture" as SeriesKind,
    note: "COMEX front-month silver future.",
  },
  dxy: {
    symbol: "DXY",
    providerSymbol: "DX-Y.NYB",
    kind: "reference" as SeriesKind,
    note: "US Dollar Index.",
  },
  vix: { symbol: "VIX", providerSymbol: "^VIX", kind: "reference" as SeriesKind, note: "CBOE Volatility Index." },
  spx: { symbol: "SPX", providerSymbol: "^GSPC", kind: "reference" as SeriesKind, note: "S&P 500 index." },
  wti: { symbol: "WTIUSD", providerSymbol: "CL=F", kind: "frontMonthFuture" as SeriesKind, note: "WTI front-month future." },
} as const;

/** FRED daily series used as features. All unrevised. */
export const MACRO_SERIES = {
  /** The opportunity-cost variable gold is most often related to. */
  realYield10y: { id: "DFII10", unit: "percent", note: "10-year TIPS yield. Daily, not revised." },
  nominal10y: { id: "DGS10", unit: "percent", note: "10-year Treasury constant maturity. Daily, not revised." },
  nominal2y: { id: "DGS2", unit: "percent", note: "2-year Treasury constant maturity. Daily, not revised." },
  breakeven10y: { id: "T10YIE", unit: "percent", note: "10-year breakeven inflation. Daily, not revised." },
  fedFunds: { id: "DFF", unit: "percent", note: "Effective federal funds rate. Daily, not revised." },
  broadDollar: { id: "DTWEXBGS", unit: "index", note: "Trade-weighted USD, broad. Daily, not revised." },
} as const;

/**
 * Revised monthly macro, deliberately NOT used as model input.
 *
 * Listed so the exclusion is explicit and reversible: the moment ALFRED
 * vintages are available, these become usable and this constant is where to
 * start. Until then, any model reading them is trading on revisions nobody had.
 */
export const EXCLUDED_REVISED_MACRO = {
  cpi: "CPIAUCSL",
  corePce: "PCEPILFE",
  unemployment: "UNRATE",
} as const;

export async function goldFutureBars(range = "10y"): Promise<PriceSeries> {
  const s = GOLD_SERIES.goldFuture;
  return { ...s, bars: await fetchBars(s.providerSymbol, range) };
}

export async function referenceBars(
  key: keyof typeof GOLD_SERIES,
  range = "10y"
): Promise<PriceSeries> {
  const s = GOLD_SERIES[key];
  return { ...s, bars: await fetchBars(s.providerSymbol, range) };
}

export async function macroSeries(key: keyof typeof MACRO_SERIES): Promise<MacroPoint[]> {
  return fetchFred(MACRO_SERIES[key].id);
}

// ---------------------------------------------------------------------------
// Basis
// ---------------------------------------------------------------------------

export interface BasisObservation {
  date: string;
  futurePrice: number;
  /** The ETF-implied reference, scaled to an ounce. */
  proxyPrice: number;
  /** futures - proxy, in dollars per ounce. */
  basis: number;
  /** As a fraction of the proxy. */
  basisPct: number;
  /** Ounces per ETF share used for the scaling, and where it came from. */
  ouncesPerShare: number;
  scalingSource: string;
}

/**
 * Basis between the futures price and an ETF-implied reference.
 *
 *   basis_t     = Future_t - Proxy_t
 *   basisPct_t  = basis_t / Proxy_t
 *   Proxy_t     = GLD_t / ouncesPerShare
 *
 * The annualized form in the brief needs days to expiry:
 *
 *   annualized = (Future/Proxy - 1) × 365 / daysToExpiry
 *
 * It is NOT computed here, because our provider serves a continuous
 * front-month series with no contract expiry attached. Producing an annualized
 * number would require inventing the denominator, and a plausible-looking carry
 * rate derived from a guessed expiry is worse than no carry rate.
 *
 * `ouncesPerShare` is a parameter with no default drawn from thin air: GLD's
 * ounces-per-share declines daily as fees accrue and the caller must supply the
 * figure they are willing to stand behind, with its source.
 */
export function basisSeries(
  future: readonly Bar[],
  etf: readonly Bar[],
  ouncesPerShare: number,
  scalingSource: string
): BasisObservation[] {
  if (!(ouncesPerShare > 0)) return [];
  const byDate = new Map(etf.map((b) => [b.date, b.close]));
  const out: BasisObservation[] = [];
  for (const f of future) {
    const e = byDate.get(f.date);
    // Dates are intersected, never zipped by index: one series having a holiday
    // the other does not would otherwise silently offset every later pair.
    if (e === undefined) continue;
    const proxyPrice = e / ouncesPerShare;
    if (!(proxyPrice > 0)) continue;
    const basis = f.close - proxyPrice;
    out.push({
      date: f.date,
      futurePrice: f.close,
      proxyPrice,
      basis,
      basisPct: basis / proxyPrice,
      ouncesPerShare,
      scalingSource,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Alignment and data-quality gates
// ---------------------------------------------------------------------------

/** Align a macro series onto price dates using the LAST value on or before
 *  each date.
 *
 * Forward-fill, never backward: on a date where the macro series has no
 * observation, the model may use the most recent PRIOR value, which is what a
 * participant knew. Interpolating between a prior and a later observation is
 * the subtle version of look-ahead — it leaks the next print backwards. */
export function alignToDates(
  dates: readonly string[],
  points: readonly MacroPoint[]
): (number | null)[] {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  const out: (number | null)[] = [];
  let i = 0;
  let last: number | null = null;
  for (const d of dates) {
    while (i < sorted.length && sorted[i]!.date <= d) {
      last = sorted[i]!.value;
      i++;
    }
    out.push(last);
  }
  return out;
}

export interface DataQuality {
  ok: boolean;
  /** Trading days between the last bar and the reference date. */
  ageDays: number | null;
  barCount: number;
  problems: string[];
}

/**
 * The gate every live signal must pass.
 *
 * A stale or thin series produces a signal that looks exactly like a fresh one.
 * When this fails the correct output is NO SIGNAL — not BUY, not SELL, and not
 * a neutral 0, which a reader will interpret as "the model has an opinion and
 * it is balanced".
 */
export function assessQuality(
  bars: readonly Bar[],
  asOf: Date,
  opts: { maxAgeDays?: number; minBars?: number } = {}
): DataQuality {
  const maxAgeDays = opts.maxAgeDays ?? 5;
  const minBars = opts.minBars ?? 250;
  const problems: string[] = [];

  if (bars.length === 0) {
    return { ok: false, ageDays: null, barCount: 0, problems: ["no bars returned by the provider"] };
  }
  const last = bars[bars.length - 1]!;
  const ageDays = Math.floor((asOf.getTime() - new Date(last.date + "T00:00:00Z").getTime()) / 86_400_000);

  if (ageDays > maxAgeDays) problems.push(`last bar is ${ageDays} days old (limit ${maxAgeDays})`);
  if (bars.length < minBars) problems.push(`only ${bars.length} bars (need ${minBars})`);

  // Non-positive prices are bad data, not cheap gold.
  if (bars.some((b) => !(b.close > 0))) problems.push("series contains a non-positive close");
  // An impossible bar means the feed is wrong; every range-based feature built
  // on it would be wrong too, quietly.
  if (bars.some((b) => b.high < b.low)) problems.push("series contains a bar with high below low");

  return { ok: problems.length === 0, ageDays, barCount: bars.length, problems };
}
