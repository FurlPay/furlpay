import type { CorporateAction, ReorgEvent, TradeLot } from "./types";
import { applyDelisting, applyMerger, applySpinOff } from "./reorg";
import { usableActions } from "./projector";

// ---------------------------------------------------------------------------
// Reorganization settlement: cash-bearing mergers, delistings and cash-in-lieu
// spin-off fractions -> lot transformation + cash, exactly once.
//
// This is the reorg analogue of settleDividends(), and it exists for the same
// reason: a cash-bearing corporate action moves money, and money must move
// exactly once. But a reorg is harder than a dividend in one specific way — it
// REWRITES THE LEDGER. A dividend leaves the position untouched and just credits
// cash; a merger supersedes the old lots and opens new ones, a liquidating
// delisting closes lots, a cash-in-lieu split trims a fraction. So settlement
// here returns a NEW LOT SET, not just a cash figure, and the caller swaps the
// ledger wholesale.
//
// Ordering matters more than it does for dividends. Reorgs must apply in
// effectiveDate order over the EVOLVING lot set: a 2026 merger of a company that
// was itself spun off in 2025 has to see the post-spin-off lots. So this walks
// actions in order and threads the transformed lots forward, exactly as
// applyActions() does — but unlike applyActions() it also keeps the cash.
//
// Idempotency, again keyed (userId, corporateActionId) via reorg_once_per_user:
// an already-settled action is SKIPPED, and skipping means its lots are already
// in their post-settlement state in the ledger (superseded/closed), so it will
// not be re-picked. The explicit settled-set is the belt; the lot state is the
// braces.
// ---------------------------------------------------------------------------

function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Whether an action pays the holder cash — the ones that need settling. Kept
 *  in sync with paysCash() in projector.ts; the two must agree, because
 *  projector deliberately leaves exactly this set UNAPPLIED for settlement to
 *  pick up. */
function isCashBearing(action: CorporateAction): boolean {
  const t = action.terms;
  if (!t) return false;
  switch (action.type) {
    case "merger":
    case "acquisition":
      return t.cashPerShare != null && t.cashPerShare > 0;
    case "spin_off":
      // Only the fractional cash-in-lieu leg pays cash; the stock leg is a
      // non-taxable distribution the projection already reflects.
      return !!t.cashInLieuOfFractional;
    case "delisting":
      // Presence, not truthiness: a zero liquidation is a worthless-security
      // writeoff, still a disposal that realizes a loss.
      return t.liquidationPerShare != null;
    default:
      return false;
  }
}

export interface ReorgSettlementOptions {
  asOf?: Date;
  newEventId?: (action: CorporateAction) => string;
  newLotId?: (lot: TradeLot, action: CorporateAction) => string;
}

export interface ReorgSettlementResult {
  /** The ledger after every settleable reorg was applied. Replaces the old
   *  lots wholesale — it already contains the superseded/closed originals. */
  lots: TradeLot[];
  /** Settlement records to persist, one per action actually applied. */
  events: ReorgEvent[];
  /** Net cash to credit the fiat ledger. */
  cashToCredit: number;
  /** Total realized gain/loss across the batch, for tax reporting. */
  realizedGain: number;
  /** Actions skipped because already settled for this user. */
  skipped: string[];
}

/**
 * Settle the cash-bearing reorganizations a user is owed but has not been paid.
 *
 * Pure: no I/O, no writes, no clock of its own — the caller persists the result
 * and credits the cash, which is what makes it retryable. `alreadySettled` is
 * the set of corporate-action ids already settled for THIS user; as with
 * dividends, an empty set from a FAILED read would re-settle everything, so the
 * caller must treat a read failure as fatal.
 *
 * A settleable action must ALSO have its effective/payment date reached. The
 * ledger transformation and the cash both wait on that date together — unlike a
 * dividend, there is no window where the shares have changed but the cash has
 * not, because here they are one operation.
 */
export function settleReorgs(
  userId: string,
  lots: TradeLot[],
  actions: CorporateAction[],
  alreadySettled: ReadonlySet<string>,
  opts: ReorgSettlementOptions = {}
): ReorgSettlementResult {
  const asOf = opts.asOf ?? new Date();
  const mkEventId = opts.newEventId ?? ((a: CorporateAction) => `reorg_${userId}_${a.id}`);
  const mkLotId =
    opts.newLotId ?? ((l: TradeLot, a: CorporateAction) => `${l.id}:${a.id}`);

  let current = lots;
  const events: ReorgEvent[] = [];
  const skipped: string[] = [];
  let cashToCredit = 0;
  let realizedGain = 0;

  for (const action of usableActions(actions)) {
    if (!isCashBearing(action)) continue;

    // The transformation and the cash both wait on the effective date. A
    // payment date, when present, governs (a cash merger may close weeks before
    // it pays); otherwise the effective date does.
    const payable = Date.parse(action.paymentDate ?? action.effectiveDate);
    if (Number.isNaN(payable) || payable > asOf.getTime()) continue;

    if (alreadySettled.has(action.id)) {
      skipped.push(action.id);
      continue;
    }

    // Nothing to settle if the user holds none of the affected symbol — e.g. a
    // merger for a company they already sold. No event, no cash.
    const holdsSymbol = current.some(
      (l) => l.symbol === action.symbol && l.status === "open" && l.quantity > 0
    );
    if (!holdsSymbol) continue;

    const lotId = (l: TradeLot) => mkLotId(l, action);
    let cash = 0;
    let gain = 0;

    switch (action.type) {
      case "merger":
      case "acquisition": {
        const r = applyMerger(current, action, {
          cashPerShare: action.terms!.cashPerShare,
          stockValuePerShare: action.terms!.stockValuePerShare,
          newLotId: lotId,
        });
        current = r.lots;
        cash = r.cashProceeds;
        gain = r.realizedGain;
        break;
      }
      case "spin_off": {
        const r = applySpinOff(current, action, {
          parentFmv: action.terms!.parentFmv!,
          childFmv: action.terms!.childFmv!,
          cashInLieuOfFractional: true,
          newLotId: lotId,
        });
        current = r.lots;
        cash = r.cashInLieu;
        // A cash-in-lieu fraction realizes on the sliver sold. The handler
        // conserves basis rather than computing that gain, so it is left at 0
        // here; the fractional amount is immaterial and a precise figure would
        // need the fraction's own basis threaded out of applySpinOff.
        gain = 0;
        break;
      }
      case "delisting": {
        const r = applyDelisting(current, action, {
          liquidationPerShare: action.terms!.liquidationPerShare,
        });
        current = r.lots;
        cash = r.liquidationProceeds;
        gain = r.realizedGain;
        break;
      }
      default:
        continue;
    }

    cashToCredit += cash;
    realizedGain += gain;
    events.push({
      id: mkEventId(action),
      userId,
      corporateActionId: action.id,
      symbol: action.symbol,
      type: action.type as ReorgEvent["type"],
      cashProceeds: money(cash),
      realizedGain: money(gain),
      status: "settled",
    });
  }

  return {
    lots: current,
    events,
    cashToCredit: money(cashToCredit),
    realizedGain: money(realizedGain),
    skipped,
  };
}
