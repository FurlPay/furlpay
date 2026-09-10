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

/** Last-resort ticker resolution through EDGAR's company browser.
 *
 * company_tickers.json is not complete. Both it and company_tickers_exchange
 * carry exactly 10,387 rows and both omit Electronic Arts, American Electric
 * Power and BNY Mellon — all three of which are actively filing (AEP filed
 * 2026-08-04, EA 2026-08-14). The submissions API knows them by CIK, so the
 * gap is in the published mapping rather than in the companies.
 *
 * This is deliberately only a fallback. The browser's ticker matching is fuzzy
 * where the bulk file is exact: BNY resolves here to BlackRock New York
 * Municipal Income Trust rather than to BNY Mellon. Consulted only after an
 * exact lookup misses, it recovers real omissions; consulted first, it would
 * introduce wrong answers for symbols the bulk file already had right. */
async function cikByEdgarSearch(ticker: string): Promise<string | null> {
  return cachedJson(`sec:cik:${ticker}`, TTL.tickerMap, async () => {
    const url =
      "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=" +
      `${encodeURIComponent(ticker)}&type=10-K&dateb=&owner=include&count=1&output=atom`;
    try {
      const res = await fetch(url, {
        headers: SEC_HEADERS,
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      if (!res.ok) return null;
      const cik = /<cik>(\d+)<\/cik>/i.exec(await res.text())?.[1];
      return cik ? cik.padStart(10, "0") : null;
    } catch {
      return null;
    }
  });
}

export async function cikFor(symbol: string): Promise<string | null> {
  const map = await tickerMap();
  const upper = symbol.toUpperCase();
  // EDGAR spells share classes with a dash: Berkshire class B is BRK-B, never
  // BRK.B. Catalogs (and this one) commonly use the dot, so a direct lookup
  // misses every dual-class name.
  const dashed = upper.replace(/\./g, "-");
  const exact = map?.[upper] ?? map?.[dashed] ?? null;
  if (exact) return exact;
  return cikByEdgarSearch(dashed);
}

// ---------------------------------------------------------------------------
// Company facts
// ---------------------------------------------------------------------------

export interface XbrlFact {
  start?: string;
  end: string;
  val: number;
  fy?: number;
  fp?: string;
  form?: string;
  filed: string;
  frame?: string;
}

export interface CompanyFacts {
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

/** Forms that carry the financial statements themselves.
 *
 * The distinction is load-bearing, not bookkeeping. A registrant tags the same
 * period in several kinds of filing, and only these state it in whole dollars.
 * The pay-versus-performance table in a proxy tags net income in whatever unit
 * that table is presented in, so FedEx's fiscal 2026 appears twice: as
 * 4,433,000,000 in the 10-K filed 2026-07-20, and as 4,433 in the DEF 14A
 * filed 2026-08-17. Same concept, same period, same USD unit, six orders of
 * magnitude apart. Schwab's proxy states the same year in thousands and
 * Arista's in millions.
 *
 * Preferring the later filing — the rule that correctly resolves a restatement
 * — picks the proxy every time, because proxy season follows the annual report.
 * FedEx's net income became $4,433. */
const STATEMENT_FORM = /^(10-K|10-Q|20-F|40-F|6-K|8-K)/i;

function fromStatement(f: XbrlFact): boolean {
  return !!f.form && STATEMENT_FORM.test(f.form);
}

/** How to resolve two facts covering the same period.
 *
 * `restated` — the newest view of the period, which is what a restatement is.
 * `broadest` — the largest value. Only for revenue, where the synonyms are
 *   nested rather than alternative: revenue from contracts with customers is a
 *   component of total revenues, not another name for it. American Tower tags
 *   both for 2025, at $0.94B and $10.64B; taking the narrower one against a
 *   company-wide operating income produced a 522% operating margin. */
type MergePolicy = "restated" | "broadest";

function preferFact(a: XbrlFact, b: XbrlFact, policy: MergePolicy): XbrlFact {
  const aStatement = fromStatement(a);
  const bStatement = fromStatement(b);
  if (aStatement !== bStatement) return aStatement ? a : b;
  if (policy === "broadest" && a.val !== b.val) return b.val > a.val ? b : a;
  return b.filed > a.filed ? b : a;
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
 * and de-duplicating by period keeps a value for each period regardless of
 * which tag carried it; `preferFact` decides which one. */
function mergeConcept(
  facts: CompanyFacts,
  names: readonly string[],
  unit: string,
  policy: MergePolicy = "restated"
): XbrlFact[] {
  const byPeriod = new Map<string, XbrlFact>();
  for (const taxonomy of ["us-gaap", "ifrs-full", "dei"]) {
    const bucket = facts.facts?.[taxonomy];
    if (!bucket) continue;
    for (const name of names) {
      for (const f of bucket[name]?.units?.[unit] ?? []) {
        const k = `${f.start ?? ""}:${f.end}`;
        const prev = byPeriod.get(k);
        byPeriod.set(k, prev ? preferFact(prev, f, policy) : f);
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

/** How stale a filed fact may be and still describe the company today.
 *
 * Eighteen months clears the widest legitimate gap: a December year-end filed
 * the following February is still the newest annual figure eleven months later,
 * and a late filer stretches that further. Anything beyond it is not a lagging
 * report, it is a concept the registrant stopped tagging. */
const MAX_FACT_AGE_DAYS = 550;

/** Does this fact's period end recently enough to be worth reporting?
 *
 * This guard exists because both of the worst wrong numbers this file has
 * produced were stale rather than miscomputed, and staleness is invisible on
 * screen — a 2014 revenue renders exactly like a 2026 one.
 *
 * `companyfacts` returns a registrant's whole tagging history and silently
 * drops dimensional facts, so a concept that moved onto an axis simply stops
 * appearing. Berkshire last reported an undimensioned share count in 2011
 * (941,481 Class A shares); multiplied by a Class B price that produced a
 * $470M market cap for a trillion-dollar company. JPMorgan stopped tagging
 * quarterly `Revenues` in 2015, so "the last four quarters" summed calendar
 * 2014 and reported $95B against an actual $182B.
 *
 * Neither is recoverable here, and both are better shown as unknown. */
function isRecent(endIso: string, now: number = Date.now()): boolean {
  const t = Date.parse(endIso);
  if (!Number.isFinite(t)) return false;
  return (now - t) / 86_400_000 <= MAX_FACT_AGE_DAYS;
}

/** Latest value of a point-in-time concept (balance sheet, share counts).
 *
 * Facts are restated: the same end date appears in several filings as later
 * ones revise it. Sorting by period then filing date and taking the last means
 * we report the most recently filed view of the most recent period, which is
 * what the company currently stands behind. */
function latestInstant(rows: XbrlFact[], now: number = Date.now()): XbrlFact | null {
  const fresh = rows.filter((f) => isRecent(f.end, now));
  if (!fresh.length) return null;
  const sorted = [...fresh].sort((a, b) =>
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
  rows: XbrlFact[],
  now: number = Date.now()
): { value: number; basis: "ttm" | "annual"; asOf: string } | null {
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
    const windowEnd = last4[last4.length - 1]!.end;
    // Recency is tested on the assembled window, not on its inputs. Testing
    // the inputs looks equivalent and is not: a trailing year that ends today
    // necessarily begins twelve months ago, and Apple's derived fourth quarter
    // is reconstructed from three quarters up to twenty months old. Filtering
    // those away dismantles the very window that makes them current, which
    // silently downgraded Apple from a $467B TTM to a $416B fiscal year.
    if (contiguous && span >= 330 && span <= 400 && isRecent(windowEnd, now)) {
      return {
        value: last4.reduce((s, q) => s + q.val, 0),
        basis: "ttm",
        asOf: windowEnd,
      };
    }
  }

  // Falling back to the fiscal year is only a fallback while that year is still
  // the company's latest word. Past the staleness horizon it is a historical
  // record, and reporting it beside a live price would date the whole page to
  // whenever the registrant stopped tagging the concept.
  const fy = annuals[annuals.length - 1];
  return fy && isRecent(fy.end, now) ? { value: fy.val, basis: "annual", asOf: fy.end } : null;
}

interface Period {
  value: number;
  basis: "ttm" | "annual";
  asOf: string;
}

/** Earnings per share, or null when it disagrees with net income and the
 * share count.
 *
 * Those three are one identity — EPS times shares is net income — so a wide
 * disagreement means one of them is on a different basis from the other two.
 *
 * In practice it is EPS, for a reason nothing above can catch. Per-share
 * figures are restated by a stock split while dollar figures are not, so a
 * trailing twelve months assembled across one sums quarters denominated in
 * different shares. Booking split during fiscal 2026: its fiscal 2025 diluted
 * EPS is $165.57 and its June 2026 quarter is $2.53, both correct as filed and
 * not addable. Summing them gave a TTM EPS of $167.96 against a post-split
 * price of $210 — a P/E of 1.25 on a company trading near 30. A dual-class
 * registrant fails the same way: Carvana's $8.45 is per Class A share against
 * a diluted count covering every class.
 *
 * The share count is a single point-in-time figure from the latest filing and
 * has neither failure mode, so it is what survives. EPS is dropped, taking the
 * P/E and payout ratio with it. Market cap does not depend on EPS and is
 * unaffected, which is right — it was correct all along.
 *
 * Recomputing EPS as net income over shares was the alternative and is worse:
 * it would pair whichever period the income happens to cover with today's
 * share count and present the quotient as a filed figure.
 *
 * Two tolerances, because the comparison is not always like-for-like. When the
 * income and EPS windows share a basis the identity should hold tightly, and
 * 35% still absorbs buybacks between the period end and the cover date. When
 * they differ — an annual income against a TTM EPS — they are expected to
 * disagree, so only an order-of-magnitude gap is a defect. Both bands sit far
 * below the twentyfold a split produces. */
function reconcileEps(
  eps: Period | null,
  netIncome: Period | null,
  shares: { value: number } | null
): Period | null {
  if (!eps || !netIncome || !shares) return eps;
  if (eps.value === 0 || !(shares.value > 0)) return eps;

  const impliedEps = netIncome.value / shares.value;
  if (!Number.isFinite(impliedEps) || impliedEps === 0) return eps;

  const hi = Math.max(Math.abs(eps.value), Math.abs(impliedEps));
  const lo = Math.min(Math.abs(eps.value), Math.abs(impliedEps));
  const limit = netIncome.basis === eps.basis ? 1.35 : 2.5;
  return hi / lo > limit ? null : eps;
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
/** Cost of revenue, for issuers that report it but never tag `GrossProfit`.
 *
 * `GrossProfit` is optional in US-GAAP. Plenty of registrants skip it and tag
 * only the cost line sitting directly under revenue on the income statement —
 * Qualcomm among them — so the margin has to be derived from the two. */
const COST_OF_REVENUE = [
  "CostOfRevenue",
  "CostOfGoodsAndServicesSold",
  "CostOfGoodsSold",
  "CostOfServices",
] as const;
const EPS = [
  "EarningsPerShareDiluted",
  "EarningsPerShareBasicAndDiluted",
  "EarningsPerShareBasic",
] as const;
/** Share-count sources, best first — tried in order rather than merged.
 *
 * These are not synonyms and must not be pooled the way the concept lists above
 * are. The cover-page count is a point-in-time total as of the filing date; the
 * weighted-average diluted count is a period average that includes unexercised
 * dilution and so runs roughly a percent high. Merging them and taking the
 * latest period end lets a tie on date decide which definition wins.
 *
 * The last entry is what rescues registrants who moved their cover-page tag
 * onto a share-class axis, where `companyfacts` no longer surfaces it. */
const SHARE_SOURCES = [
  ["EntityCommonStockSharesOutstanding"],
  ["CommonStockSharesOutstanding"],
  ["WeightedAverageNumberOfDilutedSharesOutstanding"],
] as const;

/** Equity sources, best first — tried in order rather than merged.
 *
 * Registrants migrate between these two and do not look back. Qualcomm last
 * tagged `StockholdersEquity` in 2019 and has reported the NCI-inclusive
 * concept every quarter since, so a single-concept lookup finds nothing inside
 * the staleness window and price/book, ROE and debt/equity all render as
 * em-dashes for a company that publishes its equity four times a year.
 *
 * Order matters and is deliberate. Parent-only equity is the right denominator
 * because the net income paired with it is attributable to the parent, so the
 * NCI-inclusive figure is a fallback rather than a merge — a merge would hand
 * back whichever concept happened to be filed later for a given period. */
const EQUITY_SOURCES = [
  ["StockholdersEquity"],
  ["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
] as const;

/** Total equity, for the balance-sheet identity rather than for ratios.
 *
 * Deliberately the reverse preference of EQUITY_SOURCES. Assets = liabilities +
 * total equity, so deriving liabilities needs the figure that includes
 * non-controlling interests; using parent-only equity leaves NCI sitting inside
 * "liabilities". Coca-Cola carries $2.1B of NCI and Walmart $6.3B, so the two
 * concepts are not interchangeable here even though they are close. */
const EQUITY_TOTAL_SOURCES = [
  ["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  ["StockholdersEquity"],
] as const;

/** Cash sources, best first.
 *
 * ASU 2016-18 moved the cash-flow statement onto a total that includes
 * restricted cash, and many registrants now tag only that: JPMorgan, Bank of
 * America, Starbucks and GE have no plain `CashAndCashEquivalentsAtCarryingValue`
 * inside the staleness window at all. The inclusive figure is a superset — it
 * carries restricted balances the plain one excludes — so it is a fallback
 * rather than an equal, taken only when the narrower concept is absent. */
const CASH_SOURCES = [
  ["CashAndCashEquivalentsAtCarryingValue"],
  ["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
] as const;

/** Dividend-per-share sources, best first.
 *
 * Declared is the better figure — it is the rate the board has committed to —
 * but Coca-Cola, IBM, Exxon and Home Depot tag only what was actually paid.
 * Over a trailing year the two differ by at most a timing shift. */
const DIVIDEND_SOURCES = [
  ["CommonStockDividendsPerShareDeclared"],
  ["CommonStockDividendsPerShareCashPaid"],
] as const;

/** Exposed for tests: the pure period arithmetic, with no network.
 *
 * This is the part worth pinning. Both bugs found while building it — the
 * stale-synonym pick and the missing fourth quarter — produced numbers that
 * looked entirely reasonable on screen. */
export const __test = {
  mergeConcept,
  fromStatement,
  preferFact,
  trailingTwelveMonths,
  latestInstant,
  durationDays,
  isRecent,
  MAX_FACT_AGE_DAYS,
  reconcileEps,
};

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

  const flow = (names: readonly string[], policy: MergePolicy = "restated") =>
    trailingTwelveMonths(mergeConcept(facts, names, "USD", policy));
  const instant = (names: readonly string[], unit = "USD") => {
    const f = latestInstant(mergeConcept(facts, names, unit));
    return f ? { value: f.val, asOf: f.end } : null;
  };

  const revenue = flow(REVENUE, "broadest");
  const netIncome = flow(NET_INCOME);
  const epsRaw = trailingTwelveMonths(mergeConcept(facts, EPS, "USD/shares"));
  let dividendTtm: ReturnType<typeof trailingTwelveMonths> = null;
  for (const source of DIVIDEND_SOURCES) {
    dividendTtm = trailingTwelveMonths(mergeConcept(facts, source, "USD/shares"));
    if (dividendTtm) break;
  }
  let shares: { value: number; asOf: string } | null = null;
  for (const source of SHARE_SOURCES) {
    shares = instant(source, "shares");
    if (shares) break;
  }

  const eps = reconcileEps(epsRaw, netIncome, shares);

  let equity: { value: number; asOf: string } | null = null;
  for (const source of EQUITY_SOURCES) {
    equity = instant(source);
    if (equity) break;
  }

  // Total liabilities, derived when the registrant never tags it. Thirty-one
  // percent of a large-cap sample does not: Amazon, Walmart, Coca-Cola, Oracle,
  // AT&T and others report only the balance-sheet total.
  //
  // That total, `LiabilitiesAndStockholdersEquity`, is NOT a stand-in for
  // liabilities however much the name suggests it — it equals `Assets` to the
  // dollar for every filer checked, so substituting it reports Amazon owing
  // $1,095,689M instead of $544,069M and doubles debt/equity. The identity has
  // to be closed properly: liabilities = assets - total equity, on the same
  // balance-sheet date.
  let totalEquity: { value: number; asOf: string } | null = null;
  for (const source of EQUITY_TOTAL_SOURCES) {
    totalEquity = instant(source);
    if (totalEquity) break;
  }

  // Gross profit, derived when the registrant never tags it. Subtracting cost
  // of revenue from revenue is the definition, but only when both trailing
  // windows describe the same span: an annual cost taken off a TTM revenue, or
  // a cost lagging a quarter behind, produces a margin that looks plausible and
  // is wrong. Mismatched windows stay null and render as an em-dash.
  const grossTagged = flow(["GrossProfit"]);
  const costOfRevenue = grossTagged ? null : flow(COST_OF_REVENUE);
  const grossDerived =
    revenue && costOfRevenue && revenue.asOf === costOfRevenue.asOf && revenue.basis === costOfRevenue.basis
      ? revenue.value - costOfRevenue.value
      : null;

  const assets = instant(["Assets"]);

  let cash: { value: number; asOf: string } | null = null;
  for (const source of CASH_SOURCES) {
    cash = instant(source);
    if (cash) break;
  }

  const liabilities = instant(["Liabilities"]);
  // Only closed when both sides describe the same balance sheet. Subtracting a
  // quarter-old equity from a fresher assets figure yields a number that looks
  // like a liability total and is not one.
  const derivedLiabilities =
    !liabilities && assets && totalEquity && assets.asOf === totalEquity.asOf
      ? assets.value - totalEquity.value
      : null;

  return {
    entityName: facts.entityName,
    cik,
    epsTtm: eps?.value ?? null,
    epsBasis: eps?.basis ?? null,
    revenueTtm: revenue?.value ?? null,
    netIncomeTtm: netIncome?.value ?? null,
    incomeBasis: revenue?.basis ?? netIncome?.basis ?? null,
    grossProfitTtm: grossTagged?.value ?? grossDerived,
    operatingIncomeTtm: flow(["OperatingIncomeLoss"])?.value ?? null,
    operatingCashFlowTtm: flow(["NetCashProvidedByUsedInOperatingActivities"])?.value ?? null,
    sharesOutstanding: shares?.value ?? null,
    assets: assets?.value ?? null,
    liabilities: liabilities?.value ?? derivedLiabilities,
    equity: equity?.value ?? null,
    assetsCurrent: instant(["AssetsCurrent"])?.value ?? null,
    liabilitiesCurrent: instant(["LiabilitiesCurrent"])?.value ?? null,
    cash: cash?.value ?? null,
    dividendPerShareTtm: dividendTtm?.value ?? null,
    asOf: revenue?.asOf ?? netIncome?.asOf ?? null,
    balanceAsOf: assets?.asOf ?? null,
  };
}
