import type { Holding } from "@/lib/types";
import { bySymbol } from "@/lib/markets/catalog";

// ---------------------------------------------------------------------------
// Portfolio analytics derived from the REAL position set.
//
// The split this module enforces matters more here than anywhere else in the
// app: a wealth dashboard that prints a confident Sharpe ratio next to someone's
// actual money is worse than one that prints nothing, because the reader cannot
// tell the difference between a number the platform computed and a number it
// invented.
//
// COMPUTABLE from a position snapshot (everything below is real):
//   allocation by asset class, concentration, effective holdings (1/HHI),
//   diversification, cost basis, unrealised P&L, weight per position.
//
// NOT COMPUTABLE from a snapshot — needs a daily returns series the API does
// not serve yet:
//   volatility, Sharpe ratio, beta, maximum drawdown, Value at Risk,
//   time-weighted and money-weighted return.
//
// Those are returned as `null`, and the UI renders an em dash with an
// explanation rather than a plausible-looking figure. See RiskCard.
// ---------------------------------------------------------------------------

export type AssetClass = "Stocks" | "ETFs" | "Crypto" | "Bonds" | "Cash" | "Alternatives";

/** The palette for allocation, shared by the donut and its legend. */
export const CLASS_COLORS: Record<AssetClass, string> = {
  Stocks: "#34C759",
  ETFs: "#0A84FF",
  Crypto: "#BF5AF2",
  Bonds: "#FFD60A",
  Cash: "#8E8E93",
  Alternatives: "#FF9F0A",
};

export interface AllocationSlice {
  label: AssetClass;
  value: number;
  color: string;
  weight: number;
  /** Money-weighted daily change for the class, in dollars. */
  dayChange: number;
  /** Unrealised return for the class, in dollars. */
  totalReturn: number;
  positions: number;
}

export interface PositionRow extends Holding {
  /** Cost per share — costBasis / shares. Guarded against a zero-share row. */
  avgPrice: number;
  /** Share of the invested total, 0–1. */
  weight: number;
  /** Dollar move today, from the position's own daily percentage. */
  dayChange: number;
  /** Unrealised P&L in dollars. */
  unrealized: number;
  /** Unrealised P&L as a percentage of cost. */
  unrealizedPct: number;
  assetClass: AssetClass;
}

function classify(symbol: string): AssetClass {
  const kind = bySymbol.get(symbol)?.kind;
  if (kind === "etf") return "ETFs";
  if (kind === "crypto") return "Crypto";
  return "Stocks";
}

export function toPositions(holdings: Holding[]): PositionRow[] {
  const invested = holdings.reduce((s, h) => s + h.marketValue, 0) || 1;
  return holdings.map((h) => {
    const avgPrice = h.shares > 0 ? h.costBasis / h.shares : 0;
    const unrealized = h.marketValue - h.costBasis;
    return {
      ...h,
      avgPrice,
      weight: h.marketValue / invested,
      // changePct is today's move on the CURRENT value, so the dollar figure is
      // derived from the value now rather than from cost.
      dayChange: h.marketValue - h.marketValue / (1 + h.changePct / 100),
      unrealized,
      unrealizedPct: h.costBasis > 0 ? (unrealized / h.costBasis) * 100 : 0,
      assetClass: classify(h.symbol),
    };
  });
}

export function toAllocation(positions: PositionRow[], cashUsd: number): AllocationSlice[] {
  const total = positions.reduce((s, p) => s + p.marketValue, 0) + Math.max(cashUsd, 0);
  const byClass = new Map<AssetClass, { value: number; day: number; ret: number; n: number }>();

  for (const p of positions) {
    const cur = byClass.get(p.assetClass) ?? { value: 0, day: 0, ret: 0, n: 0 };
    cur.value += p.marketValue;
    cur.day += p.dayChange;
    cur.ret += p.unrealized;
    cur.n += 1;
    byClass.set(p.assetClass, cur);
  }

  // Cash is a real allocation line, not a rounding remainder — it is the
  // difference between "invested" and "portfolio", and hiding it overstates
  // every other weight.
  if (cashUsd > 0) byClass.set("Cash", { value: cashUsd, day: 0, ret: 0, n: 1 });

  return [...byClass.entries()]
    .map(([label, v]) => ({
      label,
      value: v.value,
      color: CLASS_COLORS[label],
      weight: total > 0 ? v.value / total : 0,
      dayChange: v.day,
      totalReturn: v.ret,
      positions: v.n,
    }))
    .sort((a, b) => b.value - a.value);
}

export interface RiskProfile {
  /** 0–100, higher = more concentrated / more equity-like. Documented below. */
  score: number;
  band: "Conservative" | "Moderate" | "Aggressive";
  /** Largest single position as a share of the portfolio, 0–1. */
  concentration: number;
  topSymbol: string | null;
  /** 1 / HHI — how many equally sized positions this portfolio behaves like. */
  effectiveHoldings: number;
  /** Series-dependent metrics. Null until a returns feed exists. */
  volatility: null;
  sharpe: null;
  beta: null;
  maxDrawdown: null;
  valueAtRisk: null;
}

/**
 * A risk score computed only from what a snapshot can support.
 *
 * Two inputs, both real and both explainable to a user who asks:
 *   concentration — the largest position's weight, which is the dominant
 *                   single-name risk in a retail portfolio;
 *   diversification — 1/HHI, the number of equally weighted positions this book
 *                   behaves like, capped at 20 where the marginal benefit of
 *                   another name is negligible.
 *
 * It deliberately does NOT fold in volatility or beta. Those need a return
 * series, and blending an unavailable input into a displayed score would make
 * the score unfalsifiable.
 */
export function toRisk(positions: PositionRow[], cashUsd: number): RiskProfile {
  const invested = positions.reduce((s, p) => s + p.marketValue, 0);
  const total = invested + Math.max(cashUsd, 0);

  if (positions.length === 0 || total <= 0) {
    return {
      score: 0,
      band: "Conservative",
      concentration: 0,
      topSymbol: null,
      effectiveHoldings: 0,
      volatility: null,
      sharpe: null,
      beta: null,
      maxDrawdown: null,
      valueAtRisk: null,
    };
  }

  const sorted = [...positions].sort((a, b) => b.marketValue - a.marketValue);
  const concentration = sorted[0]!.marketValue / total;

  const hhi = positions.reduce((s, p) => {
    const w = p.marketValue / invested;
    return s + w * w;
  }, 0);
  const effectiveHoldings = hhi > 0 ? 1 / hhi : 0;

  // Concentration pushes the score up; effective breadth pulls it down; a cash
  // buffer pulls it down further because cash cannot draw down.
  const concentrationRisk = Math.min(concentration, 1) * 60;
  const breadthRelief = Math.min(effectiveHoldings / 20, 1) * 25;
  const cashRelief = (Math.max(cashUsd, 0) / total) * 20;
  const equityRisk = (invested / total) * 45;

  const score = Math.max(
    0,
    Math.min(100, Math.round(concentrationRisk + equityRisk - breadthRelief - cashRelief))
  );

  return {
    score,
    band: score >= 67 ? "Aggressive" : score >= 34 ? "Moderate" : "Conservative",
    concentration,
    topSymbol: sorted[0]!.symbol,
    effectiveHoldings,
    volatility: null,
    sharpe: null,
    beta: null,
    maxDrawdown: null,
    valueAtRisk: null,
  };
}

export interface HealthBreakdown {
  score: number;
  parts: { label: string; score: number; detail: string }[];
}

/** Portfolio health from the same snapshot inputs — every part is explainable. */
export function toHealth(
  positions: PositionRow[],
  cashUsd: number,
  risk: RiskProfile,
  totalReturnPct: number
): HealthBreakdown {
  const invested = positions.reduce((s, p) => s + p.marketValue, 0);
  const total = invested + Math.max(cashUsd, 0);
  const cashWeight = total > 0 ? Math.max(cashUsd, 0) / total : 0;

  const diversification = Math.round(Math.min(risk.effectiveHoldings / 12, 1) * 100);
  const concentration = Math.round((1 - Math.min(risk.concentration / 0.4, 1)) * 100);
  // Liquidity: a cash buffer between 2% and 10% scores full marks; far outside
  // that band is either no dry powder or an uninvested account.
  const liquidity = Math.round(
    (cashWeight <= 0.02 ? cashWeight / 0.02 : cashWeight <= 0.1 ? 1 : Math.max(0, 1 - (cashWeight - 0.1) / 0.4)) * 100
  );
  const performance = Math.round(Math.max(0, Math.min(1, (totalReturnPct + 20) / 40)) * 100);
  const riskFit = Math.round((1 - Math.abs(risk.score - 50) / 50) * 100);

  const parts = [
    { label: "Diversification", score: diversification, detail: `${risk.effectiveHoldings.toFixed(1)} effective holdings` },
    { label: "Concentration", score: concentration, detail: `${(risk.concentration * 100).toFixed(1)}% in ${risk.topSymbol ?? "—"}` },
    { label: "Risk balance", score: riskFit, detail: `${risk.band} profile` },
    { label: "Performance", score: performance, detail: `${totalReturnPct >= 0 ? "+" : ""}${totalReturnPct.toFixed(2)}% total return` },
    { label: "Liquidity", score: liquidity, detail: `${(cashWeight * 100).toFixed(1)}% in cash` },
  ];

  return {
    score: Math.round(parts.reduce((s, p) => s + p.score, 0) / parts.length),
    parts,
  };
}

/**
 * Portfolio intelligence lines, generated ONLY from facts in the snapshot.
 *
 * Every sentence names a number this module computed, so none of them is
 * filler — if a statement cannot be supported by the data it is not emitted.
 */
export function toInsights(
  positions: PositionRow[],
  allocation: AllocationSlice[],
  risk: RiskProfile,
  perf: { totalReturnPct: number; dayChangePct: number }
): string[] {
  const out: string[] = [];
  if (positions.length === 0) return out;

  const top = [...positions].sort((a, b) => b.marketValue - a.marketValue)[0]!;
  out.push(`${top.symbol} is your largest position at ${(top.weight * 100).toFixed(1)}% of invested value.`);

  const biggestClass = allocation[0];
  if (biggestClass) {
    out.push(`${biggestClass.label} account for ${(biggestClass.weight * 100).toFixed(1)}% of the portfolio across ${biggestClass.positions} ${biggestClass.positions === 1 ? "position" : "positions"}.`);
  }

  const winners = positions.filter((p) => p.unrealized > 0).length;
  out.push(`${winners} of ${positions.length} positions are showing an unrealised gain.`);

  if (risk.effectiveHoldings > 0) {
    out.push(`Your book behaves like ${risk.effectiveHoldings.toFixed(1)} equally weighted holdings — a ${risk.band.toLowerCase()} risk profile.`);
  }

  const movers = [...positions].sort((a, b) => Math.abs(b.dayChange) - Math.abs(a.dayChange))[0];
  if (movers && Math.abs(movers.dayChange) > 0.005) {
    out.push(`${movers.symbol} moved ${movers.changePct >= 0 ? "+" : ""}${movers.changePct.toFixed(2)}% today, the largest contribution to the day's change.`);
  }

  return out;
}
