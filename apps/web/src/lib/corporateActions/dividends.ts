import type { CorporateAction, DividendEvent, TradeLot } from "./types";
import { dividendEntitlement } from "./lots";
import { applyActions, usableActions } from "./projector";

// ---------------------------------------------------------------------------
// Dividend settlement: entitlement -> cash (and DRIP lots).
//
// projectDividends() is a PURE PROJECTION — it recomputes the same entitlement
// on every portfolio read. That is exactly right for display and exactly wrong
// for money: crediting cash is a side effect that must happen ONCE, and a
// function that runs on every GET would pay a holder once per page view.
//
// So settlement is a separate, explicitly idempotent step. The idempotency key
// is (userId, corporateActionId), which is not a convention invented here — it
// is the UNIQUE constraint `dividend_once_per_user` in migration 0006. The
// in-memory guard below and that constraint enforce the same rule at two
// levels, so a retried job, a double-clicked admin button and two concurrent
// lambdas all converge on one payment.
//
// Three rules that are easy to get wrong and expensive to get wrong:
//
//   1. PAYMENT DATE GATES THE CASH. Entitlement is fixed on the record date,
//      but the money does not exist until the payment date. Crediting on
//      announcement inflates a balance the holder cannot spend.
//   2. WITHHOLDING IS PER JURISDICTION, and the NET is what hits the balance.
//      Crediting gross overstates the balance by the tax and produces a
//      shortfall no reconciliation can explain.
//   3. DRIP BUYS AT THE REINVESTMENT PRICE, and the new lot's basis is the
//      NET cash reinvested — not the gross. A DRIP lot with a gross basis
//      understates every future capital gain.
// ---------------------------------------------------------------------------

function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Statutory withholding on US-source dividends, by holder tax residency.
 *
 * These are TREATY RATES for the portfolio-dividend case and are deliberately
 * conservative: where a treaty offers a reduced rate only on certification
 * (a W-8BEN on file), the higher default applies until that is proven. Paying
 * a holder too much and clawing it back is worse than withholding correctly.
 *
 * Not a complete tax engine — jurisdictions absent from this table fall back to
 * the non-treaty statutory 30%, which is the safe direction to be wrong in.
 */
const WITHHOLDING_BY_RESIDENCY: Record<string, number> = {
  US: 0, // domestic holder; backup withholding is a separate mechanism
  IN: 0.25,
  GB: 0.15,
  IE: 0.15,
  NL: 0.15,
  DE: 0.15,
  FR: 0.15,
  CA: 0.15,
  AU: 0.15,
  JP: 0.1,
  SG: 0.3, // no US treaty
  AE: 0.3, // no US treaty
};

/** Non-treaty statutory rate — the fallback for an unknown residency. */
export const DEFAULT_WITHHOLDING_RATE = 0.3;

/**
 * Withholding rate for a holder's tax residency (ISO-3166 alpha-2).
 *
 * An unknown or missing residency withholds at the full statutory rate rather
 * than at zero. Under-withholding leaves the platform owing the difference to
 * the tax authority; over-withholding is refundable to the holder.
 */
export function withholdingRateFor(residency?: string | null): number {
  if (!residency) return DEFAULT_WITHHOLDING_RATE;
  const rate = WITHHOLDING_BY_RESIDENCY[residency.toUpperCase()];
  return rate ?? DEFAULT_WITHHOLDING_RATE;
}

export interface SettlementOptions {
  /** ISO-3166 alpha-2 tax residency; drives the withholding rate. */
  residency?: string | null;
  /** Settle only dividends whose payment date has arrived. Defaults to now. */
  asOf?: Date;
  /** Reinvest cash into new lots instead of crediting it. */
  drip?: boolean;
  /**
   * Price per share used for DRIP purchases, by symbol. A symbol with no price
   * CANNOT be reinvested — the lot's basis and share count would both be
   * fiction — so it settles as cash instead.
   */
  dripPrice?: (symbol: string) => number | undefined;
  /** Id generators, injected so tests are deterministic. */
  newEventId?: (action: CorporateAction) => string;
  newLotId?: (action: CorporateAction) => string;
}

export interface SettlementResult {
  /** Dividend events to persist. Empty when everything was already settled. */
  events: DividendEvent[];
  /** New lots created by reinvestment. */
  dripLots: TradeLot[];
  /** Net cash to credit the fiat ledger — EXCLUDES anything reinvested. */
  cashToCredit: number;
  /** Total tax withheld, for reporting. */
  totalWithheld: number;
  /** Actions skipped because they were already settled for this user. */
  skipped: string[];
}

/**
 * Compute the dividend settlements owed to a user that have not already been
 * paid. Pure: no I/O, no clock of its own, no writes. The caller persists the
 * result — which is what makes the whole thing testable and safely retryable.
 *
 * `alreadySettled` is the set of corporate-action ids already paid to THIS
 * user. Pass the ids from `dividend_events`; an empty set on a failed read
 * would re-pay everything, so callers must treat a read failure as fatal
 * rather than as "nothing settled yet".
 */
export function settleDividends(
  userId: string,
  lots: TradeLot[],
  actions: CorporateAction[],
  alreadySettled: ReadonlySet<string>,
  opts: SettlementOptions = {}
): SettlementResult {
  const asOf = opts.asOf ?? new Date();
  const rate = withholdingRateFor(opts.residency);
  const mkEventId = opts.newEventId ?? ((a: CorporateAction) => `div_${userId}_${a.id}`);
  const mkLotId = opts.newLotId ?? ((a: CorporateAction) => `lot_drip_${userId}_${a.id}`);

  const events: DividendEvent[] = [];
  const dripLots: TradeLot[] = [];
  const skipped: string[] = [];
  let cashToCredit = 0;
  let totalWithheld = 0;

  for (const action of usableActions(actions)) {
    if (action.type !== "cash_dividend" || action.amountPerShare == null) continue;

    // Rule 1: entitlement is fixed on the record date, but the cash does not
    // exist until the payment date. A dividend with no payment date falls back
    // to its ex-date — the conservative reading, since a missing payment date
    // is a data gap, not a licence to pay early.
    const payable = Date.parse(action.paymentDate ?? action.effectiveDate);
    if (Number.isNaN(payable) || payable > asOf.getTime()) continue;

    // Rule 2 of idempotency: never pay the same action twice for one user.
    if (alreadySettled.has(action.id)) {
      skipped.push(action.id);
      continue;
    }

    // The position must be counted as of the RECORD DATE, with only the splits
    // and renames effective by then replayed — the same discipline
    // projectDividends() uses. A later split must not inflate an earlier
    // dividend. Delegated to that module rather than duplicated here.
    const asOfRecord = Date.parse(action.recordDate ?? action.effectiveDate);
    const priorAdjustments = usableActions(actions).filter(
      (x) =>
        (x.type === "stock_split" || x.type === "reverse_split" || x.type === "symbol_change") &&
        Date.parse(x.effectiveDate) <= asOfRecord
    );

    const ent = dividendEntitlement(applyActions(lots, priorAdjustments), action, {
      withholdingRate: rate,
    });
    if (ent.sharesHeld <= 0) continue; // held nothing on the record date

    const eventId = mkEventId(action);
    totalWithheld += ent.withholdingTax;

    // Rule 3: DRIP buys at the reinvestment price, with the NET as basis.
    const price = opts.drip ? opts.dripPrice?.(action.symbol) : undefined;
    const canReinvest = opts.drip && price != null && Number.isFinite(price) && price > 0;

    if (canReinvest && ent.netAmount > 0) {
      const dripQty = ent.netAmount / price!;
      const lotId = mkLotId(action);
      dripLots.push({
        id: lotId,
        userId,
        symbol: action.symbol,
        quantity: Math.round((dripQty + Number.EPSILON) * 1e8) / 1e8,
        // Basis is the NET cash actually reinvested. Using the gross would
        // understate every future capital gain on these shares.
        costBasis: money(ent.netAmount),
        // The payment date is when the shares were actually acquired; the
        // holding period starts here, NOT at the parent lot's acquisition.
        // Unlike a split or merger, a DRIP is a genuine new purchase.
        acquiredAt: new Date(payable).toISOString(),
        status: "open",
        provenance: "corporate_action",
        fromCorporateActionId: action.id,
      });
      events.push({
        id: eventId,
        userId,
        corporateActionId: action.id,
        symbol: action.symbol,
        sharesHeld: ent.sharesHeld,
        amountPerShare: ent.amountPerShare,
        grossAmount: ent.grossAmount,
        withholdingTax: ent.withholdingTax,
        netAmount: ent.netAmount,
        reinvested: true,
        dripLotId: lotId,
        status: "reinvested",
      });
    } else {
      cashToCredit += ent.netAmount;
      events.push({
        id: eventId,
        userId,
        corporateActionId: action.id,
        symbol: action.symbol,
        sharesHeld: ent.sharesHeld,
        amountPerShare: ent.amountPerShare,
        grossAmount: ent.grossAmount,
        withholdingTax: ent.withholdingTax,
        netAmount: ent.netAmount,
        reinvested: false,
        status: "paid",
      });
    }
  }

  return {
    events,
    dripLots,
    cashToCredit: money(cashToCredit),
    totalWithheld: money(totalWithheld),
    skipped,
  };
}
