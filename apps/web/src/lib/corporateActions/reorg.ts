import type { CorporateAction, RealizedSale, TradeLot } from "./types";
import { isSuperseded } from "./types";

// ---------------------------------------------------------------------------
// Reorganizations: mergers, spin-offs, delistings.
//
// These differ from splits in one decisive way: a split is NEVER taxable, so
// `applySplit` can preserve basis and stop thinking. A reorganization may or
// may not be taxable depending on what the holder receives, and the difference
// is the difference between owing tax this year and not:
//
//   stock-for-stock merger  NOT taxable. Basis carries to the new shares and
//                           the HOLDING PERIOD TACKS — the new lot inherits the
//                           original acquisition date. Resetting it to the
//                           merger date would convert a long-term position into
//                           a short-term one and overtax the holder on the next
//                           sale, which is the single most expensive mistake
//                           available in this file.
//   cash-out merger         TAXABLE. Gain realizes now, lots close.
//   spin-off                NOT taxable. Parent basis is APPORTIONED between
//                           parent and child by relative FMV; holding period
//                           tacks to the child too.
//   delisting               NOT a sale. The position freezes; closing it would
//                           realize a loss the holder has not taken.
//
// Same discipline as lots.ts: pure functions, no I/O, basis conserved, rounding
// only at the boundary.
// ---------------------------------------------------------------------------

function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function shares(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e8) / 1e8;
}

/** Lots this action can act on: the right symbol, and not already history. */
function affectedLots(lots: TradeLot[], symbol: string): TradeLot[] {
  return lots.filter(
    (l) => l.symbol === symbol && !isSuperseded(l) && l.status !== "closed" && l.quantity > 0
  );
}

export interface MergerResult {
  lots: TradeLot[];
  /** Cash paid to the holder (cash-out or mixed consideration). */
  cashProceeds: number;
  /** Gain realized by the cash portion. Zero for a pure stock-for-stock deal. */
  realizedGain: number;
  /** Per-lot realized detail, for tax reporting. Empty when nothing realized. */
  consumed: RealizedSale["consumed"];
}

/**
 * Apply a merger or acquisition.
 *
 * Three shapes, selected by what the holder actually receives:
 *
 *   ratio only        stock-for-stock. `ratio` new shares per old share, basis
 *                     carries whole, holding period tacks, nothing realized.
 *   cashPerShare only cash-out. Every share is bought for cash; the position
 *                     closes and the full gain realizes.
 *   both              mixed consideration. Basis is apportioned between the
 *                     cash and stock legs by relative value, and gain realizes
 *                     ONLY on the cash leg — the stock leg stays deferred.
 *
 * `stockValuePerShare` is required for the mixed case: without a value for the
 * stock leg there is no way to apportion basis between the two, and guessing
 * would misstate the realized gain. Demanded explicitly rather than defaulted.
 */
export function applyMerger(
  lots: TradeLot[],
  action: CorporateAction,
  opts: {
    cashPerShare?: number;
    stockValuePerShare?: number;
    newLotId?: (lot: TradeLot) => string;
  } = {}
): MergerResult {
  if (action.type !== "merger" && action.type !== "acquisition") {
    throw new Error(`${action.id} is ${action.type}, not a merger or acquisition`);
  }

  const ratio = action.ratio;
  const cashPerShare = opts.cashPerShare;
  const hasStock = ratio != null && Number.isFinite(ratio) && ratio > 0;
  const hasCash = cashPerShare != null && Number.isFinite(cashPerShare) && cashPerShare > 0;

  if (!hasStock && !hasCash) {
    throw new Error(
      `merger ${action.id} has neither a share ratio nor cash consideration — nothing to apply`
    );
  }
  if (hasStock && !action.newSymbol) {
    throw new Error(`merger ${action.id} pays shares but has no newSymbol`);
  }

  // Mixed consideration cannot apportion basis without a value for the stock.
  let stockValuePerShare = opts.stockValuePerShare;
  if (hasStock && hasCash) {
    if (!stockValuePerShare || !Number.isFinite(stockValuePerShare) || stockValuePerShare <= 0) {
      throw new Error(
        `merger ${action.id} pays cash AND stock but has no stockValuePerShare; ` +
          `basis cannot be apportioned between the two legs without it`
      );
    }
  } else if (!hasCash) {
    stockValuePerShare = undefined; // pure stock: no apportionment needed
  }

  const mkId = opts.newLotId ?? ((l: TradeLot) => `${l.id}:${action.id}`);
  const targets = affectedLots(lots, action.symbol);
  const superseded = new Set(targets.map((l) => l.id));

  const out: TradeLot[] = [];
  const consumed: MergerResult["consumed"] = [];
  let cashProceeds = 0;
  let realizedGain = 0;

  for (const lot of lots) {
    if (!superseded.has(lot.id)) {
      out.push(lot);
      continue;
    }

    // Per OLD share, what does the holder get?
    const cashLeg = hasCash ? cashPerShare! : 0;
    const stockLeg = hasStock ? ratio! * (stockValuePerShare ?? 0) : 0;
    const totalValue = cashLeg + stockLeg;

    // Fraction of basis attributable to the cash leg. Pure-stock → 0 (nothing
    // realizes); pure-cash → 1 (everything realizes).
    const cashFraction = hasStock && hasCash ? cashLeg / totalValue : hasCash ? 1 : 0;

    const cashBasis = lot.costBasis * cashFraction;
    const stockBasis = lot.costBasis - cashBasis;
    const lotCash = money(cashLeg * lot.quantity);

    if (hasCash) {
      cashProceeds += lotCash;
      realizedGain += lotCash - cashBasis;
      consumed.push({
        lotId: lot.id,
        quantity: shares(lot.quantity),
        costBasis: money(cashBasis),
      });
    }

    // The original always becomes history — never mutated.
    out.push({ ...lot, status: "superseded" });

    if (hasStock) {
      out.push({
        ...lot,
        id: mkId(lot),
        symbol: action.newSymbol!,
        quantity: shares(lot.quantity * ratio!),
        costBasis: money(stockBasis),
        // HOLDING PERIOD TACKS. `acquiredAt` is deliberately inherited from the
        // original lot rather than set to the merger date — see the header.
        acquiredAt: lot.acquiredAt,
        status: "open",
        provenance: "corporate_action",
        sourceLotId: lot.id,
        fromCorporateActionId: action.id,
      });
    }
  }

  return {
    lots: out,
    cashProceeds: money(cashProceeds),
    realizedGain: money(realizedGain),
    consumed,
  };
}

export interface SpinOffResult {
  lots: TradeLot[];
  /** Cash paid for fractional child shares, when cash-in-lieu is elected. */
  cashInLieu: number;
}

/**
 * Apply a spin-off: a parent distributes shares of a new company to holders.
 *
 * Not a taxable event. The parent's cost basis is APPORTIONED between the
 * parent and the child by their relative fair market values immediately after
 * the distribution — the holder's total basis is unchanged, it just now sits in
 * two positions. Assigning the child a zero basis (the naive shortcut) would
 * overstate the gain on every future sale of the child.
 *
 * `parentFmv` and `childFmv` are the post-distribution per-share values; the
 * child FMV is weighted by `ratio` because the holder receives `ratio` child
 * shares per parent share.
 */
export function applySpinOff(
  lots: TradeLot[],
  action: CorporateAction,
  opts: {
    parentFmv: number;
    childFmv: number;
    cashInLieuOfFractional?: boolean;
    newLotId?: (lot: TradeLot) => string;
  }
): SpinOffResult {
  if (action.type !== "spin_off") {
    throw new Error(`${action.id} is ${action.type}, not a spin-off`);
  }
  if (!action.newSymbol) {
    throw new Error(`spin_off ${action.id} has no newSymbol for the distributed company`);
  }

  const ratio = action.ratio;
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) {
    throw new Error(`spin_off ${action.id} has an invalid ratio: ${action.ratio}`);
  }

  const { parentFmv, childFmv } = opts;
  for (const [name, v] of [["parentFmv", parentFmv], ["childFmv", childFmv]] as const) {
    if (!Number.isFinite(v) || v <= 0) {
      throw new Error(
        `spin_off ${action.id} needs a positive ${name} to apportion cost basis (got ${v})`
      );
    }
  }

  // Basis follows value. Child value is per PARENT share held, hence × ratio.
  const childValue = childFmv * ratio;
  const childShare = childValue / (parentFmv + childValue);

  const mkId = opts.newLotId ?? ((l: TradeLot) => `${l.id}:${action.id}`);
  const targets = new Set(affectedLots(lots, action.symbol).map((l) => l.id));

  const out: TradeLot[] = [];
  let cashInLieu = 0;

  for (const lot of lots) {
    out.push(lot);
    if (!targets.has(lot.id)) continue;

    const childBasis = lot.costBasis * childShare;
    let childQty = lot.quantity * ratio;
    let allocatedBasis = childBasis;

    if (opts.cashInLieuOfFractional) {
      const whole = Math.floor(childQty);
      const fraction = childQty - whole;
      if (fraction > 0) {
        const perShare = allocatedBasis / childQty;
        const fractionBasis = perShare * fraction;
        cashInLieu += fractionBasis;
        allocatedBasis -= fractionBasis;
        childQty = whole;
      }
    }

    // The parent lot is REDUCED IN BASIS, not superseded: the holder keeps the
    // same parent shares throughout. Replacing it would break the audit chain
    // for no reason — a spin-off does not touch the parent share count.
    const parentIdx = out.findIndex((l) => l.id === lot.id);
    out[parentIdx] = {
      ...lot,
      costBasis: money(lot.costBasis - childBasis),
      basisAllocationPct: 1 - childShare,
    };

    const finalChildQty = shares(childQty);
    out.push({
      ...lot,
      id: mkId(lot),
      symbol: action.newSymbol,
      quantity: finalChildQty,
      costBasis: money(allocatedBasis),
      // Holding period tacks to the child as well.
      acquiredAt: lot.acquiredAt,
      status: finalChildQty > 0 ? "open" : "closed",
      provenance: "corporate_action",
      sourceLotId: lot.id,
      fromCorporateActionId: action.id,
      basisAllocationPct: childShare,
    });
  }

  return { lots: out, cashInLieu: money(cashInLieu) };
}

export interface DelistingResult {
  lots: TradeLot[];
  /** Cash from a liquidating distribution, if the delisting paid one out. */
  liquidationProceeds: number;
  /** Gain/loss realized by that distribution. Zero when nothing was paid. */
  realizedGain: number;
}

/**
 * Apply a delisting.
 *
 * Default: the position FREEZES. It is not a sale — the holder still owns the
 * shares, keeps the basis, and keeps the holding period. Closing the lots here
 * would realize a loss the holder has not actually taken and would hand them a
 * deduction they are not entitled to yet.
 *
 * When the delisting pays a liquidating distribution (`liquidationPerShare`),
 * that IS a disposal: cash comes in, the gain or loss realizes, lots close.
 * A zero-value liquidation is explicitly supported — a worthless-security
 * writeoff realizes the full basis as a loss, which is different from freezing.
 */
export function applyDelisting(
  lots: TradeLot[],
  action: CorporateAction,
  opts: { liquidationPerShare?: number } = {}
): DelistingResult {
  if (action.type !== "delisting") {
    throw new Error(`${action.id} is ${action.type}, not a delisting`);
  }

  const perShare = opts.liquidationPerShare;
  const liquidating = perShare != null && Number.isFinite(perShare) && perShare >= 0;
  const targets = new Set(affectedLots(lots, action.symbol).map((l) => l.id));

  let liquidationProceeds = 0;
  let realizedGain = 0;

  const out = lots.map((lot) => {
    if (!targets.has(lot.id)) return lot;

    if (!liquidating) {
      // Frozen: quantity and basis untouched, simply untradeable.
      return { ...lot, status: "frozen" as const };
    }

    const proceeds = perShare! * lot.quantity;
    liquidationProceeds += proceeds;
    realizedGain += proceeds - lot.costBasis;
    return { ...lot, quantity: 0, costBasis: 0, status: "closed" as const };
  });

  return {
    lots: out,
    liquidationProceeds: money(liquidationProceeds),
    realizedGain: money(realizedGain),
  };
}
