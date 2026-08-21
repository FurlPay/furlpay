// ---------------------------------------------------------------------------
// SEC EDGAR XBRL — authoritative US company fundamentals.
//
// This is the filing itself, not a vendor's copy of it: the numbers here are
// what the company told the SEC under signature. No API key, no crumb, no
// vendor rate card. The tradeoff is that XBRL is a filing format rather than a
// product, so the awkward parts (concept names differ per filer, periods
// overlap, the same fact is restated across filings) land on this module.
// ---------------------------------------------------------------------------

import { cachedJson, fetchJson, SEC_HEADERS, TTL } from "./cache";

// ---------------------------------------------------------------------------
// Ticker -> CIK
// ---------------------------------------------------------------------------

interface TickerRow {
  cik_str: number;
  ticker: string;
  title: string;
}

/** Ticker -> zero-padded CIK. ~10,400 US filers, refreshed weekly. */
async function tickerMap(): Promise<Record<string, string> | null> {
  return cachedJson("sec:tickers", TTL.tickerMap, async () => {
    const raw = await fetchJson<Record<string, TickerRow>>(
      "https://www.sec.gov/files/company_tickers.json",
      { headers: SEC_HEADERS, timeoutMs: 15_000 }
    );
    if (!raw) return null;
    const out: Record<string, string> = {};
    for (const row of Object.values(raw)) {
      if (!row?.ticker) continue;
      // A CIK is 10 digits zero-padded in every EDGAR path.
      out[row.ticker.toUpperCase()] = String(row.cik_str).padStart(10, "0");
    }
    return out;
  });
}

export async function cikFor(symbol: string): Promise<string | null> {
  const map = await tickerMap();
  return map?.[symbol.toUpperCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Company facts
// ---------------------------------------------------------------------------

interface XbrlFact {
  start?: string;
  end: string;
  val: number;
  fy?: number;
  fp?: string;
  form?: string;
  filed: string;
  frame?: string;
}

interface CompanyFacts {
  entityName: string;
  facts: Record<string, Record<string, { label?: string; units: Record<string, XbrlFact[]> }>>;
}

async function companyFacts(cik: string): Promise<CompanyFacts | null> {
  return cachedJson(`sec:facts:${cik}`, TTL.fundamentals, () =>
    fetchJson<CompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: SEC_HEADERS,
      timeoutMs: 20_000,
    })
  );
}

/** Every fact for a concept, merged across all of its synonyms.
 *
 * Concept naming is neither standardised across filers nor stable within one.
 * Apple reports revenue as RevenueFromContractWithCustomerExcludingAssessedTax
 * while older filings use plain Revenues — and NVIDIA has used both, migrating
 * between them mid-history.
 *
 * That migration is why this merges instead of taking the first name that
 * exists. First-match-wins looked correct and was catastrophically wrong:
 * NVIDIA's older tag is still present but stops in 2020, so picking it yielded
 * $10.9B of revenue "as of" 2026 and a 1240% net margin. Merging every synonym
 * and de-duplicating by period keeps the newest filed value for each period
 * regardless of which tag carried it. */
function mergeConcept(
  facts: CompanyFacts,
  names: readonly string[],
  unit: string
): XbrlFact[] {
  const byPeriod = new Map<string, XbrlFact>();
  for (const taxonomy of ["us-gaap", "ifrs-full", "dei"]) {
    const bucket = facts.facts?.[taxonomy];
    if (!bucket) continue;
    for (const name of names) {
      for (const f of bucket[name]?.units?.[unit] ?? []) {
        const k = `${f.start ?? ""}:${f.end}`;
        const prev = byPeriod.get(k);
        if (!prev || f.filed > prev.filed) byPeriod.set(k, f);
      }
    }
  }
  return [...byPeriod.values()];
}

/** Days covered by a fact. Zero for a point-in-time (balance sheet) fact. */
function durationDays(f: XbrlFact): number {
  if (!f.start) return 0;
  return (Date.parse(f.end) - Date.parse(f.start)) / 86_400_000;
}

/** Latest value of a point-in-time concept (balance sheet, share counts).
 *
 * Facts are restated: the same end date appears in several filings as later
 * ones revise it. Sorting by period then filing date and taking the last means
 * we report the most recently filed view of the most recent period, which is
 * what the company currently stands behind. */
function latestInstant(rows: XbrlFact[]): XbrlFact | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) =>
    a.end === b.end ? a.filed.localeCompare(b.filed) : a.end.localeCompare(b.end)
  );
  return sorted[sorted.length - 1] ?? null;
}

/** Trailing-twelve-month total for a flow concept (revenue, income, cash flow).
 *
 * Three problems have to be solved together, and each one silently corrupts the
 * result on its own.
 *
 * 1. Periods overlap. A 10-K carries the full year and the year-ago year; a
 *    10-Q carries both the quarter and the year-to-date. Summing everything
 *    roughly triples revenue, so only quarter-length periods are considered.
 *
 * 2. The fourth quarter is usually missing. Most registrants file three 10-Qs
 *    and a 10-K, and the 10-K reports the year rather than Q4 — Apple has no
 *    Q4 fact at all. Taking "the last four quarters" therefore reaches back and
 *    picks up the same quarter from the prior year, producing a twelve-month
 *    total with a hole in it. Q4 is instead derived the way data vendors derive
 *    it: the annual figure minus the three quarters inside it.
 *
 * 3. The window still has to be a real year. The four quarters must be
 *    contiguous and span 330-400 days; otherwise this is not a TTM and saying
 *    so would be a lie. In that case the annual figure is returned, labelled
 *    `annual`, so the caller can show what it actually is. */
function trailingTwelveMonths(
  rows: XbrlFact[]
): { value: number; basis: "ttm" | "annual"; asOf: string } | null {
  if (!rows.length) return null;

  const quarters = rows.filter((f) => {
    const d = durationDays(f);
    return d >= 60 && d <= 120; // a fiscal quarter, allowing for 13-week years
  });
  const annuals = rows
    .filter((f) => {
      const d = durationDays(f);
      return d >= 300 && d <= 400;
    })
    .sort((a, b) => a.end.localeCompare(b.end));

  // Derive the missing Q4 from each annual period that contains exactly three
  // reported quarters.
  const derived: XbrlFact[] = [];
  for (const a of annuals) {
    if (!a.start) continue;
    const inside = quarters.filter((q) => q.start && a.start! <= q.start && q.end <= a.end);
    if (inside.length !== 3) continue;
    const covered = inside.reduce((s, q) => s + durationDays(q), 0);
    if (covered < 250 || covered > 290) continue;
    const gapStart = inside.reduce((m, q) => (q.end > m ? q.end : m), inside[0]!.end);
    const synth: XbrlFact = {
      start: gapStart,
      end: a.end,
      val: a.val - inside.reduce((s, q) => s + q.val, 0),
      filed: a.filed,
    };
    const d = durationDays(synth);
    if (d >= 60 && d <= 120) derived.push(synth);
  }

  const byPeriod = new Map<string, XbrlFact>();
  for (const q of [...quarters, ...derived]) byPeriod.set(`${q.start}:${q.end}`, q);
  const all = [...byPeriod.values()].sort((a, b) => a.end.localeCompare(b.end));

  if (all.length >= 4) {
    const last4 = all.slice(-4);
    const contiguous = last4.every((q, i) => {
      if (i === 0) return true;
      const prevEnd = Date.parse(last4[i - 1]!.end);
      const thisStart = Date.parse(q.start!);
      return Math.abs(thisStart - prevEnd) <= 5 * 86_400_000;
    });
    const span = last4.reduce((s, q) => s + durationDays(q), 0);
    if (contiguous && span >= 330 && span <= 400) {
      return {
        value: last4.reduce((s, q) => s + q.val, 0),
        basis: "ttm",
        asOf: last4[last4.length - 1]!.end,
      };
    }
  }

  const fy = annuals[annuals.length - 1];
  return fy ? { value: fy.val, basis: "annual", asOf: fy.end } : null;
}

// Synonym lists. All of these are merged, not tried in order.
const REVENUE = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
  "SalesRevenueGoodsNet",
] as const;
const NET_INCOME = ["NetIncomeLoss", "ProfitLoss"] as const;
const EPS = [
  "EarningsPerShareDiluted",
  "EarningsPerShareBasicAndDiluted",
  "EarningsPerShareBasic",
] as const;
const SHARES = ["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"] as const;

/** Exposed for tests: the pure period arithmetic, with no network.
 *
 * This is the part worth pinning. Both bugs found while building it — the
 * stale-synonym pick and the missing fourth quarter — produced numbers that
 * looked entirely reasonable on screen. */
export const __test = { mergeConcept, trailingTwelveMonths, latestInstant, durationDays };

export interface Fundamentals {
  entityName: string;
  cik: string;
  /** Diluted EPS, trailing twelve months where four quarters are available. */
  epsTtm: number | null;
  epsBasis: "ttm" | "annual" | null;
  revenueTtm: number | null;
  netIncomeTtm: number | null;
  /** Basis actually used for the revenue/income figures above. */
  incomeBasis: "ttm" | "annual" | null;
  grossProfitTtm: number | null;
  operatingIncomeTtm: number | null;
  operatingCashFlowTtm: number | null;
  sharesOutstanding: number | null;
  assets: number | null;
  liabilities: number | null;
  equity: number | null;
  assetsCurrent: number | null;
  liabilitiesCurrent: number | null;
  cash: number | null;
  /** Dividends declared per share over the trailing year, if any. */
  dividendPerShareTtm: number | null;
  /** Period end date the income figures cover. */
  asOf: string | null;
  /** Latest balance-sheet date. */
  balanceAsOf: string | null;
}

/** Real, filed fundamentals for a US-listed ticker.
 *
 * Returns null for anything EDGAR does not cover — ETFs, crypto, and foreign
 * issuers that file 20-F without XBRL detail. Null means "we do not have this",
 * and the caller must render it as unknown rather than substituting a guess. */
export async function fundamentalsFor(symbol: string): Promise<Fundamentals | null> {
  const cik = await cikFor(symbol);
  if (!cik) return null;

  const facts = await companyFacts(cik);
  if (!facts) return null;

  const flow = (names: readonly string[]) => trailingTwelveMonths(mergeConcept(facts, names, "USD"));
  const instant = (names: readonly string[], unit = "USD") => {
    const f = latestInstant(mergeConcept(facts, names, unit));
    return f ? { value: f.val, asOf: f.end } : null;
  };

  const revenue = flow(REVENUE);
  const netIncome = flow(NET_INCOME);
  const eps = trailingTwelveMonths(mergeConcept(facts, EPS, "USD/shares"));
  const dividendTtm = trailingTwelveMonths(
    mergeConcept(facts, ["CommonStockDividendsPerShareDeclared"], "USD/shares")
  );
  const shares = instant(SHARES, "shares");
  const assets = instant(["Assets"]);

  return {
    entityName: facts.entityName,
    cik,
    epsTtm: eps?.value ?? null,
    epsBasis: eps?.basis ?? null,
    revenueTtm: revenue?.value ?? null,
    netIncomeTtm: netIncome?.value ?? null,
    incomeBasis: revenue?.basis ?? netIncome?.basis ?? null,
    grossProfitTtm: flow(["GrossProfit"])?.value ?? null,
    operatingIncomeTtm: flow(["OperatingIncomeLoss"])?.value ?? null,
    operatingCashFlowTtm: flow(["NetCashProvidedByUsedInOperatingActivities"])?.value ?? null,
    sharesOutstanding: shares?.value ?? null,
    assets: assets?.value ?? null,
    liabilities: instant(["Liabilities"])?.value ?? null,
    equity: instant(["StockholdersEquity"])?.value ?? null,
    assetsCurrent: instant(["AssetsCurrent"])?.value ?? null,
    liabilitiesCurrent: instant(["LiabilitiesCurrent"])?.value ?? null,
    cash: instant(["CashAndCashEquivalentsAtCarryingValue"])?.value ?? null,
    dividendPerShareTtm: dividendTtm?.value ?? null,
    asOf: revenue?.asOf ?? netIncome?.asOf ?? null,
    balanceAsOf: assets?.asOf ?? null,
  };
}
