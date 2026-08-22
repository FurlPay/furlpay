import {
  DASH,
  fmtCountCompact,
  fmtMoneyCompact,
  fmtMultiple,
  fmtPct,
  fmtPerShare,
  fmtDate,
} from "./format";
import type { SymbolStats } from "./types";

// The statistics grid. Every cell is a value the providers either supplied or
// computed from what they supplied; a cell with no value shows an em-dash and
// says why on hover.
//
// Grouping is deliberate. A flat grid of twenty numbers is a wall, and the
// groups are how a reader knows which ones are comparable to each other:
// valuation multiples move with the price, filed figures move once a quarter.

interface Stat {
  label: string;
  value: string;
  /** Shown on hover — what the metric means, and where it comes from. */
  hint: string;
}

function groupsFor(stats: SymbolStats, kind: "stock" | "etf" | "crypto"): Array<{
  title: string;
  items: Stat[];
}> {
  const market: Stat[] = [
    {
      label: "Prev close",
      value: fmtPerShare(stats.previousClose),
      hint: "Last regular-session closing price.",
    },
    // Day range and 52-week range are deliberately absent. Both are already in
    // the header as bars with the current price marked on them, which is the
    // form that answers "is this near its high?" at a glance. Repeating them
    // here as text put two prices and a dash into a half-width cell, where
    // they truncated to "$307.01 - $312..." — a number cut in half is not a
    // smaller number, it is an unreadable one.
    {
      label: "Volume",
      value: fmtCountCompact(stats.volume),
      hint: "Shares traded in the current session.",
    },
    {
      label: "Avg volume",
      value: fmtCountCompact(stats.avgVolume),
      hint: "Mean daily volume over the last three months of sessions.",
    },
    {
      label: "Exchange",
      value: stats.exchange ?? DASH,
      hint: "Venue the quoted price comes from.",
    },
  ];

  if (kind === "crypto") {
    // A coin's equivalent of the equity size block. Circulating supply is the
    // count behind the market cap; the gap to max supply is the dilution still
    // to come, which is the fact a coin's own documentation is least likely to
    // put in front of a buyer.
    const supply: Stat[] = [
      {
        label: "Market cap",
        value: fmtMoneyCompact(stats.marketCap),
        hint: "Price times circulating supply, as reported by CoinGecko.",
      },
      {
        label: "Fully diluted",
        value: fmtMoneyCompact(stats.fullyDilutedValuation),
        hint: "Market cap if the entire maximum supply were in circulation.",
      },
      {
        label: "Circulating",
        value: fmtCountCompact(stats.circulatingSupply),
        hint: "Coins in circulation today.",
      },
      {
        label: "Max supply",
        value:
          stats.maxSupply === null
            ? "Uncapped"
            : fmtCountCompact(stats.maxSupply),
        hint: "Hard cap on total issuance. Many chains have none, which is itself the answer.",
      },
      {
        label: "All-time high",
        value: fmtPerShare(stats.athPrice),
        hint: stats.athDate ? `Reached ${fmtDate(stats.athDate.slice(0, 10))}.` : "Highest price ever traded.",
      },
      {
        label: "All-time low",
        value: fmtPerShare(stats.atlPrice),
        hint: stats.atlDate ? `Reached ${fmtDate(stats.atlDate.slice(0, 10))}.` : "Lowest price ever traded.",
      },
    ];
    return [
      { title: "Market", items: market },
      { title: "Supply", items: supply },
    ];
  }

  const size: Stat[] = [
    {
      label: "Market cap",
      value: fmtMoneyCompact(stats.marketCap),
      hint: "Price times shares outstanding, using the share count on the latest filing's cover page.",
    },
    {
      label: "Enterprise value",
      value: fmtMoneyCompact(stats.enterpriseValue),
      hint: "Market cap plus total liabilities less cash. Liabilities overstate debt, so this is an approximation.",
    },
    {
      label: "Shares out",
      value: fmtCountCompact(stats.sharesOutstanding),
      hint: "Shares outstanding as reported on the latest filing.",
    },
    { label: "Beta (1Y)", value: fmtMultiple(stats.beta), hint: "Sensitivity to SPY, regressed over one year of daily returns." },
  ];

  const valuation: Stat[] = [
    {
      label: "P/E (TTM)",
      value: fmtMultiple(stats.peRatio),
      hint: "Price divided by trailing earnings per share. Blank for a loss-making company, which has no P/E.",
    },
    { label: "EPS (TTM)", value: fmtPerShare(stats.eps), hint: "Diluted earnings per share, trailing twelve months." },
    { label: "Price / sales", value: fmtMultiple(stats.priceToSales), hint: "Market cap divided by trailing revenue." },
    { label: "Price / book", value: fmtMultiple(stats.priceToBook), hint: "Market cap divided by shareholders' equity." },
  ];

  const performance: Stat[] = [
    { label: "Revenue (TTM)", value: fmtMoneyCompact(stats.revenueTtm), hint: "Total revenue over the trailing twelve months." },
    { label: "Net income (TTM)", value: fmtMoneyCompact(stats.netIncomeTtm), hint: "Bottom-line profit over the trailing twelve months." },
    { label: "Gross margin", value: fmtPct(stats.grossMarginPct), hint: "Gross profit as a share of revenue. Not reported by banks or by every filer." },
    { label: "Operating margin", value: fmtPct(stats.operatingMarginPct), hint: "Operating income as a share of revenue." },
    { label: "Profit margin", value: fmtPct(stats.profitMarginPct), hint: "Net income as a share of revenue." },
    { label: "Return on equity", value: fmtPct(stats.roePct), hint: "Net income divided by shareholders' equity." },
    { label: "Return on assets", value: fmtPct(stats.roaPct), hint: "Net income divided by total assets." },
    { label: "Current ratio", value: fmtMultiple(stats.currentRatio), hint: "Current assets over current liabilities." },
  ];

  const income: Stat[] = [
    { label: "Dividend / share", value: fmtPerShare(stats.dividendPerShareTtm), hint: "Dividends declared per share over the trailing year." },
    { label: "Dividend yield", value: fmtPct(stats.dividendYieldPct), hint: "Trailing dividends per share divided by the current price." },
    { label: "Payout ratio", value: fmtPct(stats.payoutRatioPct), hint: "Share of earnings paid out as dividends." },
    { label: "Debt / equity", value: fmtMultiple(stats.debtToEquity), hint: "Total liabilities over shareholders' equity." },
  ];

  return [
    { title: "Market", items: market },
    { title: "Size", items: size },
    { title: "Valuation", items: valuation },
    { title: kind === "etf" ? "Fund" : "Performance", items: performance },
    { title: "Income & leverage", items: income },
  ];
}

export default function KeyStatsGrid({
  stats,
  kind,
}: {
  stats: SymbolStats;
  kind: "stock" | "etf" | "crypto";
}) {
  const groups = groupsFor(stats, kind).filter((g) =>
    // A group where nothing resolved is five em-dashes under a heading. That
    // reads as a broken page rather than as an honest gap, so it is dropped
    // and the provenance note carries the explanation instead.
    g.items.some((i) => i.value !== DASH)
  );

  if (!groups.length) {
    return (
      <p className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-6 text-center text-[13px] text-textSecondary">
        No statistics available for this asset.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-textMuted">
            {group.title}
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-0">
            {group.items.map((s) => (
              <div
                key={s.label}
                title={s.hint}
                className="flex items-center justify-between gap-3 border-b border-white/[0.05] py-2.5"
              >
                <span className="shrink-0 text-[12px] text-textSecondary">{s.label}</span>
                <span
                  className={`truncate font-mono text-[13px] font-semibold ${
                    s.value === DASH ? "text-textMuted" : ""
                  }`}
                >
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
