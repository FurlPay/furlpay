// ---------------------------------------------------------------------------
// Position sizing — "risk N% of the account on this trade" -> a share count.
//
// WHY THIS EXISTS. The order ticket takes a dollar notional. That is the wrong
// question: a $5,000 position with the stop 1% away risks $50, and the same
// $5,000 with the stop 20% away risks $1,000. A user choosing a notional is
// choosing their exposure without choosing their risk, and the two are only
// related through the stop distance — which the ticket never asked about.
//
// So the direction is inverted here: the caller states what they are willing to
// LOSE and where the stop sits, and the size falls out.
//
// SCOPE, STATED UP FRONT BECAUSE IT IS NARROWER THAN IT LOOKS. This computes
// sizing for UNLEVERAGED long/short positions in the account's own currency,
// which is what FurlPay's broker actually offers — Alpaca supports US equities,
// crypto and options, and does NOT support forex. There is deliberately no
// margin, leverage, lot or pip arithmetic in this file: FurlPay holds no CFTC
// RFED, MiFID II or MAS CMS licence, so leveraged FX is not a product it can
// offer, and a leverage engine here would be dead code implying otherwise.
//
// Pip/lot sizing belongs in this file ONLY if a licensed FX venue is ever wired
// up. It is not, so it is not here.
// ---------------------------------------------------------------------------

export class PositionSizingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PositionSizingError";
  }
}

export interface SizingInput {
  /** Account equity in the account currency. */
  equity: number;
  /** Fraction of equity the caller accepts losing if the stop fills. 0.02 = 2%. */
  riskFraction: number;
  /** Intended entry price. */
  entryPrice: number;
  /** Stop price. Below entry for a long, above for a short. */
  stopPrice: number;
  /** Long or short — decides which side of entry the stop must sit on. */
  side: "buy" | "sell";
}

export interface SizingResult {
  /** Shares/units to trade. Fractional: Alpaca supports fractional equities. */
  quantity: number;
  /** quantity * entryPrice — the exposure, which is NOT the risk. */
  notional: number;
  /** Per-unit loss if the stop fills exactly. */
  riskPerUnit: number;
  /** The amount actually at risk, which may be slightly under the budget
   *  because quantity is rounded DOWN. Never over. */
  riskAmount: number;
  /** riskAmount / equity. Reported so a caller can show what was really used. */
  actualRiskFraction: number;
  /** How far the stop is from entry, as a fraction of entry. */
  stopDistanceFraction: number;
}

/** Most money is lost by sizing off a stop that is too tight to survive noise. */
export const MIN_STOP_DISTANCE_FRACTION = 0.0005; // 5 bps

/**
 * The largest fraction of equity this function will size for in one position.
 *
 * Not a regulatory number — a sanity bound. Sizing a single position to risk
 * more than a quarter of the account is almost always a typo (0.5 meant as
 * "0.5%" rather than "50%"), and the cost of being wrong about that is the
 * account. A caller who genuinely means it can do the arithmetic themselves.
 */
export const MAX_RISK_FRACTION = 0.25;

/**
 * Size a position from a risk budget.
 *
 *   quantity = floor( (equity * riskFraction) / |entry - stop| )
 *
 * Rounded DOWN, always. Rounding up would risk more than the caller authorised,
 * and "slightly smaller than asked" is a materially different kind of wrong from
 * "slightly larger than authorised".
 */
export function sizePosition(input: SizingInput): SizingResult {
  const { equity, riskFraction, entryPrice, stopPrice, side } = input;

  for (const [name, v] of [
    ["equity", equity],
    ["riskFraction", riskFraction],
    ["entryPrice", entryPrice],
    ["stopPrice", stopPrice],
  ] as const) {
    if (!Number.isFinite(v)) throw new PositionSizingError(`${name} must be a finite number, got ${v}`);
  }
  if (equity <= 0) throw new PositionSizingError("equity must be positive.");
  if (entryPrice <= 0) throw new PositionSizingError("entryPrice must be positive.");
  if (stopPrice <= 0) throw new PositionSizingError("stopPrice must be positive.");
  if (riskFraction <= 0) throw new PositionSizingError("riskFraction must be positive.");
  if (riskFraction > MAX_RISK_FRACTION) {
    throw new PositionSizingError(
      `riskFraction ${riskFraction} exceeds the ${MAX_RISK_FRACTION} ceiling. ` +
        `If 2% was intended, pass 0.02 rather than 2.`
    );
  }

  // THE DIRECTION CHECK, which is the one that prevents a nonsense position. A
  // long whose stop sits ABOVE entry is not a small mistake — it is a stop that
  // triggers on the move the trade is betting on, and the arithmetic below would
  // still return a confident-looking number for it.
  if (side === "buy" && stopPrice >= entryPrice) {
    throw new PositionSizingError(
      `A long's stop must be BELOW entry (got stop ${stopPrice} >= entry ${entryPrice}). ` +
        `A stop above entry would trigger immediately on the intended move.`
    );
  }
  if (side === "sell" && stopPrice <= entryPrice) {
    throw new PositionSizingError(
      `A short's stop must be ABOVE entry (got stop ${stopPrice} <= entry ${entryPrice}).`
    );
  }

  const riskPerUnit = Math.abs(entryPrice - stopPrice);
  const stopDistanceFraction = riskPerUnit / entryPrice;
  if (stopDistanceFraction < MIN_STOP_DISTANCE_FRACTION) {
    // Guarding against a divide-by-almost-zero that returns an enormous size.
    throw new PositionSizingError(
      `The stop is ${(stopDistanceFraction * 100).toFixed(4)}% from entry, below the ` +
        `${(MIN_STOP_DISTANCE_FRACTION * 100).toFixed(2)}% minimum. A stop this tight sizes the ` +
        `position enormously and is filled by ordinary spread noise rather than by the thesis failing.`
    );
  }

  const riskBudget = equity * riskFraction;
  // Floor to 6 decimals: fractional shares are supported, but an unbounded float
  // makes the reported risk unreproducible against the quantity actually sent.
  const raw = riskBudget / riskPerUnit;
  const quantity = Math.floor(raw * 1e6) / 1e6;

  if (quantity <= 0) {
    throw new PositionSizingError(
      `A risk budget of ${riskBudget} cannot buy even a minimal position with ` +
        `${riskPerUnit} of risk per unit.`
    );
  }

  const riskAmount = quantity * riskPerUnit;
  return {
    quantity,
    notional: quantity * entryPrice,
    riskPerUnit,
    riskAmount,
    actualRiskFraction: riskAmount / equity,
    stopDistanceFraction,
  };
}

export interface RewardRisk {
  /** Reward divided by risk. 2 means the target is twice the stop distance. */
  ratio: number;
  riskPerUnit: number;
  rewardPerUnit: number;
}

/**
 * Reward-to-risk for a bracket, from the three prices.
 *
 * Kept separate from `sizePosition` because a target is optional — a position can
 * be sized with a stop and no target, and forcing a target in order to get a size
 * would invent a number the caller did not choose.
 */
export function rewardRisk(input: {
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  side: "buy" | "sell";
}): RewardRisk {
  const { entryPrice, stopPrice, targetPrice, side } = input;
  if (![entryPrice, stopPrice, targetPrice].every((v) => Number.isFinite(v) && v > 0)) {
    throw new PositionSizingError("entry, stop and target must all be positive finite numbers.");
  }
  if (side === "buy" && !(targetPrice > entryPrice)) {
    throw new PositionSizingError("A long's target must be above entry.");
  }
  if (side === "sell" && !(targetPrice < entryPrice)) {
    throw new PositionSizingError("A short's target must be below entry.");
  }

  const riskPerUnit = Math.abs(entryPrice - stopPrice);
  const rewardPerUnit = Math.abs(targetPrice - entryPrice);
  if (riskPerUnit === 0) throw new PositionSizingError("Stop equals entry — risk is undefined, not zero.");
  return { ratio: rewardPerUnit / riskPerUnit, riskPerUnit, rewardPerUnit };
}

/**
 * The stop price implied by a risk budget and a chosen size — the inverse of
 * `sizePosition`, for the user who starts from "I want 100 shares".
 */
export function impliedStop(input: {
  equity: number;
  riskFraction: number;
  entryPrice: number;
  quantity: number;
  side: "buy" | "sell";
}): number {
  const { equity, riskFraction, entryPrice, quantity, side } = input;
  if (!(quantity > 0)) throw new PositionSizingError("quantity must be positive.");
  if (!(equity > 0) || !(riskFraction > 0)) {
    throw new PositionSizingError("equity and riskFraction must be positive.");
  }
  const perUnit = (equity * riskFraction) / quantity;
  const stop = side === "buy" ? entryPrice - perUnit : entryPrice + perUnit;
  if (stop <= 0) {
    throw new PositionSizingError(
      `That size cannot be protected within the risk budget: the implied stop is ${stop}, ` +
        `at or below zero. Reduce the quantity or raise the budget.`
    );
  }
  return stop;
}
