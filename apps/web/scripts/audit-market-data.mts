// ---------------------------------------------------------------------------
// Accuracy audit for the market data behind /markets/[symbol].
//
//   npx tsx scripts/audit-market-data.mts            # whole catalog
//   npx tsx scripts/audit-market-data.mts AAPL JPM   # named symbols
//   npx tsx scripts/audit-market-data.mts --kind stock --json out.json
//   npx tsx scripts/audit-market-data.mts --universe 300    # random universe sample
//
// Every number on a stock page is either fetched or arithmetic over fetched
// inputs, so nothing here can be checked against an expected value — there is
// no second copy of the truth to compare with. What can be checked is whether
// each figure is *possible*: a P/E of 0.04, a $470M market cap on a
// trillion-dollar company, and revenue dated to 2014 are all impossible, and
// all three shipped looking entirely ordinary on screen.
//
// So this walks the catalog and asserts the invariants that hold for any real
// company. A missing value is never a finding — null is how this codebase says
// "we do not know", and it renders as an em-dash. A *present and impossible*
// value is a finding, because it renders as a fact.
// ---------------------------------------------------------------------------

import { CATALOG, type AssetKind } from "../src/lib/markets/catalog";
import { UNIVERSE } from "../src/lib/markets/universe";
import { realStatsFor, type RealStats } from "../src/lib/markets/providers";
import { writeFileSync } from "node:fs";

type Severity = "error" | "warn";
interface Finding {
  symbol: string;
  severity: Severity;
  code: string;
  detail: string;
}

/** Business days between a period end and now. Fundamentals are quarterly, so
 * anything past two quarters plus a filing lag is a concept that stopped being
 * tagged rather than a report that has not landed yet. */
function daysSince(iso: string): number {
  return (Date.now() - Date.parse(iso)) / 86_400_000;
}

/** The invariants. Each one is a statement that is true of every real company,
 * so a violation is a defect in this pipeline rather than an unusual issuer. */
function check(symbol: string, kind: AssetKind, s: RealStats, curated = true): Finding[] {
  const out: Finding[] = [];
  const err = (code: string, detail: string) =>
    out.push({ symbol, severity: "error", code, detail });
  const warn = (code: string, detail: string) =>
    out.push({ symbol, severity: "warn", code, detail });

  // --- price -------------------------------------------------------------
  if (s.price === null) {
    warn("no-price", "no quote from any provider");
  } else if (!(s.price > 0)) {
    err("price-nonpositive", `price=${s.price}`);
  }

  // A quote outside its own 52-week range is contradictory: the range is
  // supposed to contain today. When it happens, the two came from different
  // symbols — the classic share-class or ticker-collision failure.
  if (s.price !== null && s.high52w !== null && s.low52w !== null) {
    if (s.low52w > s.high52w) err("range-inverted", `52w low ${s.low52w} > high ${s.high52w}`);
    // A small tolerance: the range updates on a delay against a live print.
    const tol = 0.02;
    if (s.price > s.high52w * (1 + tol))
      err("price-above-52w", `price ${s.price} vs 52w high ${s.high52w}`);
    if (s.price < s.low52w * (1 - tol))
      err("price-below-52w", `price ${s.price} vs 52w low ${s.low52w}`);
  }

  if (s.price !== null && s.dayHigh !== null && s.dayLow !== null) {
    if (s.dayLow > s.dayHigh) err("day-range-inverted", `day low ${s.dayLow} > high ${s.dayHigh}`);
  }

  if (s.changePct !== null && Math.abs(s.changePct) > 50 && kind !== "crypto")
    warn("change-implausible", `${s.changePct.toFixed(1)}% in one session`);

  // --- staleness ---------------------------------------------------------
  // The failure this audit exists for. A filed figure carries the period it
  // covers; if that period is old the figure is history, and printing it
  // beside a live price dates the page to whenever tagging stopped.
  const asOf = s.provenance.fiscalAsOf;
  if (asOf) {
    const age = daysSince(asOf);
    if (age > 550) err("fundamentals-stale", `income figures dated ${asOf} (${Math.round(age)}d)`);
    else if (age > 400) warn("fundamentals-aging", `income figures dated ${asOf}`);
  }

  // --- size --------------------------------------------------------------
  if (s.marketCap !== null) {
    if (!(s.marketCap > 0)) err("mcap-nonpositive", `marketCap=${s.marketCap}`);
    // The billion-dollar floor holds only for the curated set, which is all
    // large- and mega-caps: one priced under a billion means the share count is
    // on the wrong basis, which is how Berkshire's Class A count met a Class B
    // price. The wider universe is full of genuine micro-caps, so the same
    // check there would flag several thousand correct pages.
    else if (curated && kind === "stock" && s.marketCap < 1e9)
      err("mcap-implausible", `$${(s.marketCap / 1e6).toFixed(0)}M for a curated name`);
    // No company is worth twenty trillion dollars, curated or not.
    else if (s.marketCap > 2e13) err("mcap-implausible", `$${(s.marketCap / 1e12).toFixed(1)}T`);
  }

  // Cross-check against the company's own per-share arithmetic: net income
  // divided by diluted EPS is the share count the filer used.
  if (s.netIncomeTtm !== null && s.epsTtm !== null && s.epsTtm > 0 && s.sharesOutstanding !== null) {
    const implied = s.netIncomeTtm / s.epsTtm;
    const drift = Math.abs(s.sharesOutstanding - implied) / implied;
    if (drift > 0.35)
      err(
        "share-basis-mismatch",
        `filed ${(s.sharesOutstanding / 1e6).toFixed(0)}M vs implied ` +
          `${(implied / 1e6).toFixed(0)}M (${(drift * 100).toFixed(0)}% apart)`
      );
  }

  // --- valuation ---------------------------------------------------------
  // A P/E is a price divided by a per-share figure. Under 1 means the two are
  // in different units, not that the market is offering a 25x return.
  if (s.peRatio !== null) {
    if (s.peRatio <= 0) err("pe-nonpositive", `P/E=${s.peRatio}`);
    else if (s.peRatio < 1) err("pe-implausible", `P/E=${s.peRatio.toFixed(3)}`);
    else if (s.peRatio > 2000) warn("pe-extreme", `P/E=${s.peRatio.toFixed(0)}`);
  }
  if (s.priceToSales !== null && s.priceToSales > 500)
    warn("ps-extreme", `P/S=${s.priceToSales.toFixed(0)}`);

  // --- margins and returns ------------------------------------------------
  // Margins are shares of revenue and cannot exceed it. Above 100% means the
  // numerator and denominator came from different periods or different tags.
  for (const [label, v] of [
    ["gross", s.grossMarginPct],
    ["operating", s.operatingMarginPct],
    ["profit", s.profitMarginPct],
  ] as const) {
    if (v === null) continue;
    if (v > 100.5) err("margin-over-100", `${label} margin ${v.toFixed(1)}%`);
    if (v < -1000) warn("margin-extreme", `${label} margin ${v.toFixed(0)}%`);
  }

  if (s.dividendYieldPct !== null && s.dividendYieldPct > 25)
    warn("yield-extreme", `dividend yield ${s.dividendYieldPct.toFixed(1)}%`);

  // Beta is a regression coefficient against SPY. The band has to admit
  // inverse and leveraged funds, which are a large slice of the tradable
  // universe and whose negative betas are correct rather than broken:
  // Direxion's TSM Bear fund measures -2.15 and a YieldMax short-COIN fund
  // -2.08, both exactly what those products are built to do. A -3x fund over a
  // high-beta index reaches further still. What this is actually looking for is
  // a misaligned pairing of the two return series, which lands far outside any
  // real fund's mandate.
  if (s.beta !== null && (s.beta < -8 || s.beta > 8))
    err("beta-implausible", `beta=${s.beta.toFixed(2)}`);

  // --- coverage ----------------------------------------------------------
  // Not defects — these say which sections of the page will render empty.
  if (curated && kind === "stock" && s.provenance.fundamentals === null)
    warn("no-fundamentals", "no SEC filings resolved; the stats grid will be empty");
  if (kind !== "crypto" && s.marketCap === null && s.provenance.fundamentals !== null)
    warn("no-mcap", "filings resolved but no usable share count");
  if (kind === "crypto" && s.marketCap === null)
    warn("crypto-no-mcap", "no market cap or supply for a coin");

  // Supply is a count of coins, so circulating cannot exceed the cap.
  if (s.circulatingSupply !== null && s.maxSupply !== null && s.circulatingSupply > s.maxSupply * 1.001)
    err(
      "supply-over-cap",
      `circulating ${s.circulatingSupply.toExponential(2)} > max ${s.maxSupply.toExponential(2)}`
    );

  // The all-time high is the highest price ever traded, so today's price
  // cannot exceed it by a meaningful margin. When it does, the price and the
  // history came from different assets.
  if (s.price !== null && s.athPrice !== null && s.price > s.athPrice * 1.05)
    err("price-above-ath", `price ${s.price} vs all-time high ${s.athPrice}`);

  return out;
}

async function main() {
  const argv = process.argv.slice(2);

  // Flags take a value, so the token after one is never a ticker. Parsing
  // positionally without accounting for that read the `--universe 250` count
  // as a symbol named "250" and filtered the run down to nothing.
  const FLAGS_WITH_VALUE = new Set(["--json", "--kind", "--universe"]);
  const flags = new Map<string, string | undefined>();
  const named: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok.startsWith("--")) {
      if (FLAGS_WITH_VALUE.has(tok)) flags.set(tok, argv[++i]);
      else flags.set(tok, undefined);
    } else {
      named.push(tok.toUpperCase());
    }
  }

  const jsonPath = flags.get("--json") ?? null;
  const kindFilter = (flags.get("--kind") as AssetKind | undefined) ?? null;

  // `--universe N` audits a random N of the uncurated tradable symbols. Those
  // pages are served from live data alone, so they are exactly where an
  // invariant tuned on curated mega-caps is most likely to be wrong — and
  // there are 12,655 of them, far too many to sweep on every run.
  const universeMode = flags.has("--universe");
  let assets: Array<{ symbol: string; kind: AssetKind; cg?: string; curated: boolean }>;

  if (universeMode) {
    const n = Number(flags.get("--universe") ?? 200);
    const curatedSyms = new Set(CATALOG.map((a) => a.symbol.toUpperCase()));
    const pool = UNIVERSE.filter((u) => !curatedSyms.has(u.symbol.toUpperCase()));
    // Deterministic stride rather than Math.random, so a finding can be
    // reproduced by re-running the same command.
    const stride = Math.max(1, Math.floor(pool.length / n));
    assets = pool
      .filter((_, i) => i % stride === 0)
      .slice(0, n)
      .map((u) => ({
        symbol: u.symbol,
        kind: (u.exchange === "ARCA" || u.exchange === "BATS" ? "etf" : "stock") as AssetKind,
        curated: false,
      }));
  } else {
    assets = CATALOG.map((a) => ({ symbol: a.symbol, kind: a.kind, cg: a.cg, curated: true }));
  }

  if (kindFilter) assets = assets.filter((a) => a.kind === kindFilter);
  if (named.length) assets = assets.filter((a) => named.includes(a.symbol.toUpperCase()));

  console.log(`Auditing ${assets.length} assets...\n`);

  const findings: Finding[] = [];
  const rows: Array<Record<string, unknown>> = [];
  let done = 0;

  // Sequential on purpose. Both upstreams are free, shared and rate-limited by
  // IP; a parallel sweep of 391 symbols is the fastest way to get this host
  // blocked and take the live site down with it.
  for (const a of assets) {
    let s: RealStats | null = null;
    try {
      s = await realStatsFor(a.symbol, a.kind, a.cg ?? null);
    } catch (e) {
      findings.push({
        symbol: a.symbol,
        severity: "error",
        code: "threw",
        detail: (e as Error).message,
      });
    }
    if (s) {
      findings.push(...check(a.symbol, a.kind, s, a.curated));
      rows.push({
        symbol: a.symbol,
        kind: a.kind,
        price: s.price,
        marketCap: s.marketCap,
        peRatio: s.peRatio,
        epsTtm: s.epsTtm,
        revenueTtm: s.revenueTtm,
        fiscalAsOf: s.provenance.fiscalAsOf,
        incomeBasis: s.provenance.incomeBasis,
      });
    }
    done++;
    if (done % 25 === 0) process.stdout.write(`  ${done}/${assets.length}\n`);
  }

  const errors = findings.filter((f) => f.severity === "error");
  const warns = findings.filter((f) => f.severity === "warn");

  const byCode = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byCode.get(f.code) ?? [];
    list.push(f);
    byCode.set(f.code, list);
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log(`${assets.length} audited · ${errors.length} errors · ${warns.length} warnings`);
  console.log("=".repeat(72));

  for (const [code, list] of [...byCode.entries()].sort(
    (a, b) => b[1].length - a[1].length
  )) {
    const sev = list[0]!.severity.toUpperCase();
    console.log(`\n[${sev}] ${code} — ${list.length}`);
    for (const f of list.slice(0, 12)) console.log(`   ${f.symbol.padEnd(8)} ${f.detail}`);
    if (list.length > 12) console.log(`   ... and ${list.length - 12} more`);
  }

  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({ findings, rows }, null, 2));
    console.log(`\nWrote ${jsonPath}`);
  }

  // Errors are impossible values that would render as facts. Warnings are
  // gaps that render as em-dashes and are safe to ship.
  process.exit(errors.length ? 1 : 0);
}

main();
