import type {
  CorporateAction,
  DividendEntitlement,
  LotMethod,
  RealizedSale,
  TradeLot,
} from "./types";

// ---------------------------------------------------------------------------
// Tax-lot arithmetic.
//
// Pure functions over lots — no I/O, no store access — so every rule here is
// exhaustively testable. Two invariants hold across EVERY operation and are
// asserted in the test suite:
//
//   1. A split never creates or destroys value: total cost basis is unchanged.
//   2. A sale never invents shares: consumed quantity equals the sale quantity,
//      and no lot goes negative.
//
// Money is rounded only at the boundary (2dp), never mid-calculation — rounding
// each intermediate step is how basis silently drifts away from reality.
// ---------------------------------------------------------------------------

/** Round to cents. Applied at the END of a calculation, never between steps. */
function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Share quantities keep 8dp — enough for fractional investing without
 *  accumulating float noise across many lots. */
function shares(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e8) / 1e8;
}

/** Open lots for a symbol, ordered by the chosen cost-basis method. */
export function orderLots(lots: TradeLot[], method: LotMethod): TradeLot[] {
  const open = lots.filter((l) => l.status === "open" && l.quantity > 0);
  const byTime = (a: TradeLot, b: TradeLot) =>
    Date.parse(a.acquiredAt) - Date.parse(b.acquiredAt);
  switch (method) {
    case "fifo":
      return [...open].sort(byTime);
    case "lifo":
      return [...open].sort((a, b) => byTime(b, a));
    case "hifo":
      // Highest cost per share first — minimises realized gain.
      return [...open].sort(
        (a, b) => b.costBasis / b.quantity - a.costBasis / a.quantity
      );
  }
}

/** Total open share count for a symbol. */
export function positionQuantity(lots: TradeLot[], symbol: string): number {
  return shares(
    lots
      .filter((l) => l.symbol === symbol && l.status === "open")
      .reduce((s, l) => s + l.quantity, 0)
  );
}

/** Total open cost basis for a symbol. */
export function positionCostBasis(lots: TradeLot[], symbol: string): number {
  return money(
    lots
      .filter((l) => l.symbol === symbol && l.status === "open")
      .reduce((s, l) => s + l.costBasis, 0)
  );
}

/**
 * Apply a sale against open lots.
 *
 * Consumes lots in the order the method dictates, splitting the final lot
 * proportionally when the sale lands mid-lot. Returns the realized gain plus
 * the resulting lot set — the caller persists it; nothing is mutated here.
 *
 * Throws when the position is short of the requested quantity: silently
 * selling what you do not hold is how a ledger goes negative.
 */
export function applySale(
  lots: TradeLot[],
  symbol: string,
  quantity: number,
  proceeds: number,
  method: LotMethod = "fifo"
): RealizedSale {
  if (!(quantity > 0)) throw new Error("sale quantity must be positive");

  const symbolLots = lots.filter((l) => l.symbol === symbol);
  const available = positionQuantity(symbolLots, symbol);
  if (shares(quantity) > available) {
    throw new Error(
      `insufficient position: selling ${quantity} of ${symbol} but only ${available} held`
    );
  }

  const ordered = orderLots(symbolLots, method);
  const consumed: RealizedSale["consumed"] = [];
  const updated = new Map<string, TradeLot>();
  let toFill = quantity;

  for (const lot of ordered) {
    if (toFill <= 0) break;
    const take = Math.min(lot.quantity, toFill);
    // Basis moves with the shares, proportionally. Using the lot's average
    // basis is correct: within a lot every share cost the same.
    const takenBasis = (lot.costBasis * take) / lot.quantity;

    consumed.push({ lotId: lot.id, quantity: shares(take), costBasis: money(takenBasis) });

    const remainingQty = shares(lot.quantity - take);
    updated.set(lot.id, {
      ...lot,
      quantity: remainingQty,
      costBasis: money(lot.costBasis - takenBasis),
      status: remainingQty > 0 ? "open" : "closed",
    });
    toFill = shares(toFill - take);
  }

  const costBasis = money(consumed.reduce((s, c) => s + c.costBasis, 0));
  const remaining = lots.map((l) => updated.get(l.id) ?? l);

  return {
    consumed,
    proceeds: money(proceeds),
    costBasis,
    realizedGain: money(proceeds - costBasis),
    remaining,
  };
}

/**
 * Apply a stock split (or reverse split) to every open lot of a symbol.
 *
 * The defining rule: TOTAL COST BASIS IS UNCHANGED. A 2-for-1 split doubles the
 * share count and halves the per-share basis; the holder is no richer or poorer
 * and owes no tax. Getting this wrong silently corrupts every downstream P&L
 * number, which is precisely why the old mutate-in-place model could not
 * support it.
 *
 * Each affected lot is marked `split_adjusted` and REPLACED by a new lot that
 * references it, so the pre-split position stays reconstructable.
 *
 * `cashInLieuOfFractional` mirrors what most brokers do with the fractional
 * remainder of a reverse split: pay it out rather than issue a part share. The
 * cash is returned so the caller can credit it; the basis leaves with it.
 */
export function applySplit(
  lots: TradeLot[],
  action: CorporateAction,
  opts: { cashInLieuOfFractional?: boolean; newLotId?: (lot: TradeLot) => string } = {}
): { lots: TradeLot[]; cashInLieu: number } {
  const ratio = action.ratio;
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) {
    throw new Error(`split ${action.id} has an invalid ratio: ${action.ratio}`);
  }

  const mkId = opts.newLotId ?? ((l: TradeLot) => `${l.id}:${action.id}`);
  const effectiveMs = Date.parse(action.effectiveDate);
  let cashInLieu = 0;
  const out: TradeLot[] = [];

  for (const lot of lots) {
    // A split only adjusts shares held as of its ex-date. A lot acquired ON or
    // AFTER the ex-date was bought at the post-split price and must NOT be split
    // again — critical once full corporate-action history is ingested: a 2020
    // 4:1 split must not quadruple a position opened in 2026. An unparseable
    // effectiveDate falls back to "applies", preserving prior behaviour for a
    // malformed manual row rather than silently skipping it.
    const heldByExDate = Number.isNaN(effectiveMs) || Date.parse(lot.acquiredAt) < effectiveMs;
    const affected = lot.symbol === action.symbol && lot.status === "open" && heldByExDate;
    if (!affected) {
      out.push(lot);
      continue;
    }

    let newQty = lot.quantity * ratio;
    let newBasis = lot.costBasis; // invariant: basis does not change

    if (opts.cashInLieuOfFractional) {
      const whole = Math.floor(newQty);
      const fraction = newQty - whole;
      if (fraction > 0 && whole > 0) {
        // Basis follows the shares that left. Per-share basis is computed on
        // the POST-split quantity, which is what the fraction is a part of.
        const perShare = newBasis / newQty;
        const fractionBasis = perShare * fraction;
        cashInLieu += fractionBasis;
        newBasis -= fractionBasis;
        newQty = whole;
      }
    }

    // Supersede rather than mutate: the original stays as an audit record.
    out.push({ ...lot, status: "split_adjusted" });
    out.push({
      ...lot,
      id: mkId(lot),
      quantity: shares(newQty),
      costBasis: money(newBasis),
      status: "open",
      // The replacement is a derived row, not a fill — keep that visible.
      provenance: "corporate_action",
      sourceLotId: lot.id,
      fromCorporateActionId: action.id,
    });
  }

  return { lots: out, cashInLieu: money(cashInLieu) };
}

/**
 * Compute a cash-dividend entitlement from the position held on the RECORD
 * DATE — not today's position. Shares bought after the ex-date do not receive
 * the dividend, and using the current holding is the classic way to over-pay.
 */
export function dividendEntitlement(
  lots: TradeLot[],
  action: CorporateAction,
  opts: { withholdingRate?: number } = {}
): DividendEntitlement {
  if (action.type !== "cash_dividend") {
    throw new Error(`${action.id} is ${action.type}, not a cash dividend`);
  }
  const perShare = action.amountPerShare;
  if (!perShare || !Number.isFinite(perShare) || perShare < 0) {
    throw new Error(`dividend ${action.id} has an invalid amountPerShare`);
  }

  // Record date governs; fall back to the effective (ex) date.
  const asOf = Date.parse(action.recordDate ?? action.effectiveDate);
  const held = lots
    .filter(
      (l) =>
        l.symbol === action.symbol &&
        l.status !== "split_adjusted" &&
        Date.parse(l.acquiredAt) <= asOf
    )
    .reduce((s, l) => s + l.quantity, 0);

  const sharesHeld = shares(held);
  const grossAmount = money(sharesHeld * perShare);
  const withholdingTax = money(grossAmount * (opts.withholdingRate ?? 0));

  return {
    symbol: action.symbol,
    corporateActionId: action.id,
    sharesHeld,
    amountPerShare: perShare,
    grossAmount,
    withholdingTax,
    netAmount: money(grossAmount - withholdingTax),
  };
}

/** Rename a symbol across lots (FB → META). Identity and basis are untouched:
 *  a ticker change is not an economic event. */
export function applySymbolChange(lots: TradeLot[], action: CorporateAction): TradeLot[] {
  const to = action.newSymbol;
  if (!to) throw new Error(`symbol_change ${action.id} has no newSymbol`);
  return lots.map((l) => (l.symbol === action.symbol ? { ...l, symbol: to } : l));
}
