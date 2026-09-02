// ---------------------------------------------------------------------------
// A backtest whose job is to be able to say "no edge".
//
// The failure mode of every backtest is that it is built by someone who wants
// it to work, so these are the constraints, chosen before any result was seen:
//
// SIGNALS ARE ACTED ON AT THE NEXT BAR. A signal computed from today's close
// cannot be filled at today's close. Every position uses bar t's signal and
// bar t+1's return. Skipping this is worth an enormous, entirely fake Sharpe.
//
// COSTS ARE CHARGED ON TURNOVER, NOT PER BAR. Holding a position costs nothing;
// changing it costs the spread plus slippage. A strategy that flips daily
// should be punished for it, and a costless backtest hides exactly that.
//
// WALK-FORWARD IS THE ONLY RESULT THAT COUNTS. Parameters are chosen on a
// training window and applied to the window that follows, repeatedly. The
// in-sample number is reported alongside purely so the gap between them is
// visible — that gap is the overfitting.
//
// WHAT THIS DOES NOT MODEL, and therefore what its numbers are not: intraday
// fills, bid/ask at the touch, contract rollover and its carry, margin, market
// hours, latency. GC=F from the provider is a continuous front-month series
// whose splices already contain roll gaps we do not adjust for. Results here
// are an upper bound on a daily-close strategy, not an execution estimate.
// ---------------------------------------------------------------------------

import type { Bar } from "./features";

export interface Trade {
  date: string;
  /** Target position after this bar's signal, in units of full size. */
  position: number;
  /** Change in position, which is what costs money. */
  turnover: number;
  /** Return earned over the FOLLOWING bar. */
  forwardReturn: number;
  /** Strategy return after costs. */
  netReturn: number;
}

export interface BacktestResult {
  from: string;
  to: string;
  bars: number;
  /** Compound annual growth rate of the equity curve. */
  cagr: number | null;
  annualizedReturn: number;
  annualizedVol: number;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  maxDrawdown: number;
  hitRate: number | null;
  profitFactor: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  expectancy: number | null;
  /** Average absolute position change per bar. */
  turnover: number;
  /** 5% historical value at risk and conditional VaR, per bar. */
  var95: number | null;
  cvar95: number | null;
  maxConsecutiveLosses: number;
  totalCostDrag: number;
  equityCurve: { date: string; equity: number }[];
  trades: Trade[];
}

export interface CostModel {
  /** Round-trip cost as a fraction of notional, charged on |Δposition|.
   *  A 5bp default is deliberately not optimistic for a liquid future. */
  costPerUnitTurnover: number;
}

const PERIODS_PER_YEAR = 252;

/**
 * Run a position series against forward returns.
 *
 * `positions[i]` is the position decided using information up to and including
 * bar i, and it earns the return from bar i to bar i+1. The alignment is the
 * whole point; it is enforced here rather than left to the caller.
 */
export function runBacktest(
  bars: readonly Bar[],
  positions: readonly (number | null)[],
  costs: CostModel = { costPerUnitTurnover: 0.0005 }
): BacktestResult | null {
  if (bars.length < 30 || positions.length !== bars.length) return null;

  const trades: Trade[] = [];
  const equityCurve: { date: string; equity: number }[] = [];
  let equity = 1;
  let prevPos = 0;
  let costDrag = 0;

  for (let i = 0; i < bars.length - 1; i++) {
    const pos = positions[i];
    // A null position means the model declined to have an opinion — usually a
    // failed data gate. Flat, and the exit is charged like any other trade.
    const target = pos ?? 0;
    const turnover = Math.abs(target - prevPos);
    const cost = turnover * costs.costPerUnitTurnover;
    costDrag += cost;

    const p0 = bars[i]!.close;
    const p1 = bars[i + 1]!.close;
    const fwd = p0 > 0 ? p1 / p0 - 1 : 0;
    const net = target * fwd - cost;

    equity *= 1 + net;
    trades.push({ date: bars[i]!.date, position: target, turnover, forwardReturn: fwd, netReturn: net });
    equityCurve.push({ date: bars[i + 1]!.date, equity });
    prevPos = target;
  }

  const rets = trades.map((t) => t.netReturn);
  if (rets.length < 20) return null;

  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const sd = Math.sqrt(variance);
  const annualizedReturn = mean * PERIODS_PER_YEAR;
  const annualizedVol = sd * Math.sqrt(PERIODS_PER_YEAR);

  // Downside deviation uses only negative returns; a strategy is not penalised
  // for upside dispersion.
  const downside = rets.filter((r) => r < 0);
  const dd = downside.length
    ? Math.sqrt(downside.reduce((a, b) => a + b * b, 0) / downside.length) * Math.sqrt(PERIODS_PER_YEAR)
    : null;

  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const p of equityCurve) {
    peak = Math.max(peak, p.equity);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, 1 - p.equity / peak);
  }

  const years = rets.length / PERIODS_PER_YEAR;
  const cagr = equity > 0 && years > 0 ? Math.pow(equity, 1 / years) - 1 : null;

  // Hit rate is measured over bars where a position was actually held. Counting
  // flat bars as wins is a common way to inflate it above 50%.
  const active = trades.filter((t) => t.position !== 0);
  const wins = active.filter((t) => t.netReturn > 0);
  const losses = active.filter((t) => t.netReturn < 0);
  const grossWin = wins.reduce((a, t) => a + t.netReturn, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.netReturn, 0);

  const sorted = [...rets].sort((a, b) => a - b);
  const idx = Math.max(0, Math.floor(sorted.length * 0.05) - 1);
  const var95 = sorted.length ? sorted[idx]! : null;
  const tail = sorted.slice(0, idx + 1);
  const cvar95 = tail.length ? tail.reduce((a, b) => a + b, 0) / tail.length : null;

  let run = 0;
  let maxRun = 0;
  for (const t of active) {
    if (t.netReturn < 0) { run++; maxRun = Math.max(maxRun, run); } else run = 0;
  }

  return {
    from: bars[0]!.date,
    to: bars[bars.length - 1]!.date,
    bars: bars.length,
    cagr,
    annualizedReturn,
    annualizedVol,
    sharpe: annualizedVol > 0 ? annualizedReturn / annualizedVol : null,
    sortino: dd && dd > 0 ? annualizedReturn / dd : null,
    calmar: maxDrawdown > 0 && cagr !== null ? cagr / maxDrawdown : null,
    maxDrawdown,
    hitRate: active.length ? wins.length / active.length : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    averageWin: wins.length ? grossWin / wins.length : null,
    averageLoss: losses.length ? -grossLoss / losses.length : null,
    expectancy: active.length ? active.reduce((a, t) => a + t.netReturn, 0) / active.length : null,
    turnover: trades.reduce((a, t) => a + t.turnover, 0) / trades.length,
    var95,
    cvar95,
    maxConsecutiveLosses: maxRun,
    totalCostDrag: costDrag,
    equityCurve,
    trades,
  };
}

export interface WalkForwardWindow {
  trainFrom: string;
  trainTo: string;
  testFrom: string;
  testTo: string;
  chosenParam: number;
  /** Result on the training window, for the parameter chosen there. */
  inSampleSharpe: number | null;
  /** Result on the untouched window that follows it. */
  outOfSampleSharpe: number | null;
  outOfSampleReturn: number;
}

export interface WalkForwardResult {
  windows: WalkForwardWindow[];
  /** Sharpe of the concatenated out-of-sample returns — the only number here
   *  that is not contaminated by parameter selection. */
  combinedOutOfSampleSharpe: number | null;
  combinedOutOfSampleReturn: number;
  /** Mean in-sample minus mean out-of-sample Sharpe. Large is bad: it is the
   *  portion of the backtest that was fitted rather than discovered. */
  overfitGap: number | null;
}

/**
 * Anchored walk-forward: choose a parameter on everything up to a point, apply
 * it to the window that follows, roll forward, repeat.
 *
 * `buildPositions` must be a pure function of bars and a parameter, and must
 * itself never look forward. This function cannot enforce that; it can only
 * make sure the parameter is never chosen using the window it is scored on.
 */
export function walkForward(
  bars: readonly Bar[],
  params: readonly number[],
  buildPositions: (bars: readonly Bar[], param: number) => (number | null)[],
  opts: { trainBars?: number; testBars?: number; costs?: CostModel } = {}
): WalkForwardResult {
  const trainBars = opts.trainBars ?? 756; // ~3 years
  const testBars = opts.testBars ?? 126; // ~6 months
  const costs = opts.costs ?? { costPerUnitTurnover: 0.0005 };

  const windows: WalkForwardWindow[] = [];
  const oosReturns: number[] = [];

  for (let start = trainBars; start + testBars <= bars.length; start += testBars) {
    const train = bars.slice(0, start);
    const test = bars.slice(start - 1, start + testBars); // -1 so the first test bar has a prior close

    let best: { param: number; sharpe: number | null } | null = null;
    for (const p of params) {
      const r = runBacktest(train, buildPositions(train, p), costs);
      if (!r || r.sharpe === null) continue;
      if (!best || (best.sharpe ?? -Infinity) < r.sharpe) best = { param: p, sharpe: r.sharpe };
    }
    if (!best) continue;

    const testResult = runBacktest(test, buildPositions(test, best.param), costs);
    if (!testResult) continue;

    windows.push({
      trainFrom: train[0]!.date,
      trainTo: train[train.length - 1]!.date,
      testFrom: test[0]!.date,
      testTo: test[test.length - 1]!.date,
      chosenParam: best.param,
      inSampleSharpe: best.sharpe,
      outOfSampleSharpe: testResult.sharpe,
      outOfSampleReturn: testResult.trades.reduce((a, t) => a + t.netReturn, 0),
    });
    for (const t of testResult.trades) oosReturns.push(t.netReturn);
  }

  let combined: number | null = null;
  if (oosReturns.length > 20) {
    const m = oosReturns.reduce((a, b) => a + b, 0) / oosReturns.length;
    const v = oosReturns.reduce((a, b) => a + (b - m) ** 2, 0) / (oosReturns.length - 1);
    const sd = Math.sqrt(v);
    combined = sd > 0 ? (m * PERIODS_PER_YEAR) / (sd * Math.sqrt(PERIODS_PER_YEAR)) : null;
  }

  const isVals = windows.map((w) => w.inSampleSharpe).filter((v): v is number => v !== null);
  const oosVals = windows.map((w) => w.outOfSampleSharpe).filter((v): v is number => v !== null);
  const overfitGap =
    isVals.length && oosVals.length
      ? isVals.reduce((a, b) => a + b, 0) / isVals.length -
        oosVals.reduce((a, b) => a + b, 0) / oosVals.length
      : null;

  return {
    windows,
    combinedOutOfSampleSharpe: combined,
    combinedOutOfSampleReturn: oosReturns.reduce((a, b) => a + b, 0),
    overfitGap,
  };
}
