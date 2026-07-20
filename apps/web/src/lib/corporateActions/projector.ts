import type { Holding } from "@/lib/types";
import type { CorporateAction, LotMethod, TradeLot } from "./types";
import { applySale, applySplit, applySymbolChange, dividendEntitlement, positionCostBasis, positionQuantity } from "./lots";
import { applyDelisting, applyMerger, applySpinOff } from "./reorg";

// ---------------------------------------------------------------------------
// Portfolio projection: tradeLots + corporateActions -> Holding[]
//
// `holdings` used to BE the truth — a buy did `shares += qty`, a sell scaled the
// basis by a fraction. Here it becomes a derived view. The lot ledger is the
// only thing written; positions are recomputed from it.
//
// That inversion is what makes corporate actions possible at all: a split can
// rewrite the lots it applies to without anyone having to guess what the holder
// originally paid, and the pre-split state remains readable afterwards.
//
// Pure and deterministic: same lots + same actions => same holdings, every time.
// ---------------------------------------------------------------------------

/** Live quote inputs, keyed by symbol. Missing entries simply leave the
 *  position unpriced rather than defaulting to 0 (a zero market value reads as
 *  a wiped-out position). */
export interface QuoteLookup {
  (symbol: string): { price: number; changePct: number; name?: string } | undefined;
}

/**
 * Order corporate actions the way they actually happened.
 *
 * Sorted by effectiveDate, NOT insertion order — a late-arriving split must
 * still apply before the dividend that followed it, or the dividend pays on a
 * pre-split share count. Ties break on id so the result is stable.
 */
export function orderActions(actions: CorporateAction[]): CorporateAction[] {
  return [...actions].sort((a, b) => {
    const d = Date.parse(a.effectiveDate) - Date.parse(b.effectiveDate);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });
}

/**
 * Drop actions that must not be applied:
 *   - superseded rows (a correction replaced them)
 *   - duplicates by id (a retried ingest must not double-apply a split)
 *
 * Idempotency lives here rather than at the call site because EVERY consumer
 * needs it, and a doubly-applied 2:1 split silently quadruples a position.
 */
export function usableActions(actions: CorporateAction[]): CorporateAction[] {
  const superseded = new Set(actions.map((a) => a.supersedes).filter(Boolean) as string[]);
  const seen = new Set<string>();
  const out: CorporateAction[] = [];
  for (const a of orderActions(actions)) {
    if (superseded.has(a.id)) continue; // a later correction replaced this row
    if (seen.has(a.id)) continue; // duplicate delivery
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

/**
 * Replay corporate actions over a lot set.
 *
 * Only actions that change LOTS are replayed here — splits and symbol changes.
 * Cash dividends do not alter a position (they credit cash), so they are
 * computed separately via dividendEntitlement() and deliberately skipped.
 */
export function applyActions(lots: TradeLot[], actions: CorporateAction[]): TradeLot[] {
  let current = lots;
  for (const action of usableActions(actions)) {
    if (paysCash(action)) continue; // see below — settlement, not projection
    const terms = action.terms ?? {};
    switch (action.type) {
      case "stock_split":
      case "reverse_split":
        // Deliberately NOT passing cashInLieuOfFractional: see paysCash().
        current = applySplit(current, action).lots;
        break;
      case "symbol_change":
        current = applySymbolChange(current, action);
        break;
      case "merger":
      case "acquisition":
        // Reached only for PURE stock-for-stock deals; anything with a cash leg
        // was filtered out above.
        current = applyMerger(current, action, {
          stockValuePerShare: terms.stockValuePerShare,
        }).lots;
        break;
      case "spin_off":
        // Basis apportionment is impossible without both FMVs. Skipping is the
        // only safe response: assigning the child a zero basis would overstate
        // the gain on every future sale of it, and silently inventing an FMV
        // would be worse. The position stays whole under the parent until the
        // terms arrive.
        if (terms.parentFmv && terms.childFmv) {
          current = applySpinOff(current, action, {
            parentFmv: terms.parentFmv,
            childFmv: terms.childFmv,
          }).lots;
        }
        break;
      case "delisting":
        // Reached only for a NON-liquidating delisting, which just freezes the
        // position and moves no money.
        current = applyDelisting(current, action).lots;
        break;
      default:
        // cash_dividend credits cash without altering the position, and
        // stock_dividend / rights_issue have no handler yet. Ignoring them here
        // is intentional, not an oversight.
        break;
    }
  }
  return current;
}

/**
 * Does this action pay the holder money?
 *
 * Cash-bearing actions are EXCLUDED from the projection, and the reason is
 * structural rather than fussy. applyActions() is pure and is recomputed on
 * every portfolio read, so it has nowhere to put cash — every handler here is
 * called for its `.lots` and its cash figure is discarded. For an action that
 * both moves shares AND pays out, replaying it in the projection destroys
 * value: a cash-out merger would close the position while the proceeds never
 * arrive, and a cash-in-lieu split would delete the fractional basis into
 * nothing. The holder watches shares disappear and no money appear.
 *
 * So these actions stay UNAPPLIED in the read model until a settlement step
 * writes both halves together — the same split between projection and
 * settlement that cash dividends already use (see dividends.ts). An unapplied
 * merger shows the holder still owning the old position, which is imprecise but
 * true: they have not been paid yet.
 *
 * NOTE: reorg settlement is not built. Dividends have settleDividends(); the
 * equivalent for cash mergers, liquidating delistings and cash-in-lieu
 * fractions does not exist yet, so those actions are currently inert rather
 * than half-applied. Inert is recoverable; half-applied is a support ticket
 * about vanished shares.
 */
function paysCash(action: CorporateAction): boolean {
  const t = action.terms;
  if (!t) return false;
  if (t.cashInLieuOfFractional) return true;
  if (t.cashPerShare != null && t.cashPerShare > 0) return true;
  // Zero is meaningful (worthless-security writeoff) but still a disposal that
  // realizes a loss, so presence — not truthiness — is the test.
  if (action.type === "delisting" && t.liquidationPerShare != null) return true;
  return false;
}

/**
 * Project the current portfolio.
 *
 * marketValue and changePct come from live quotes; shares and costBasis come
 * exclusively from the lot ledger. A position with no quote keeps a real share
 * count and basis but reports price 0 — the caller decides how to render that
 * (see `unpriced` in the result).
 */
export function projectHoldings(
  lots: TradeLot[],
  actions: CorporateAction[],
  quote: QuoteLookup
): Holding[] {
  const adjusted = applyActions(lots, actions);
  const symbols = [...new Set(adjusted.filter((l) => l.status === "open").map((l) => l.symbol))];

  const holdings: Holding[] = [];
  for (const symbol of symbols.sort()) {
    const shares = positionQuantity(adjusted, symbol);
    if (shares <= 0) continue; // fully closed position

    const costBasis = positionCostBasis(adjusted, symbol);
    const q = quote(symbol);
    const price = q?.price ?? 0;

    holdings.push({
      symbol,
      name: q?.name ?? symbol,
      shares,
      price,
      changePct: q?.changePct ?? 0,
      marketValue: round2(shares * price),
      costBasis,
    });
  }
  return holdings;
}

/** One projected cash-dividend entitlement for the portfolio read model. */
export interface DividendProjection {
  symbol: string;
  corporateActionId: string;
  amountPerShare: number;
  sharesHeld: number;
  grossAmount: number;
  netAmount: number;
  exDate: string;
  recordDate: string | null;
  paymentDate: string | null;
}

/**
 * Project cash-dividend entitlements from the ledger.
 *
 * Each dividend pays on the position held on its RECORD DATE, and that count
 * must be taken on the ledger AS OF that date: a split with an earlier ex-date
 * changes the share count the dividend pays on, so only the splits/renames
 * effective on or before the record date are replayed before counting — a later
 * split must NOT inflate an earlier dividend. Superseded and duplicate rows are
 * dropped by usableActions(), so a re-ingested feed never double-pays.
 *
 * Pure and deterministic, like projectHoldings — no I/O, no clock.
 */
export function projectDividends(
  lots: TradeLot[],
  actions: CorporateAction[],
  opts: { withholdingRate?: number } = {}
): DividendProjection[] {
  const usable = usableActions(actions);
  const out: DividendProjection[] = [];
  for (const a of usable) {
    if (a.type !== "cash_dividend" || a.amountPerShare == null) continue;
    const asOf = Date.parse(a.recordDate ?? a.effectiveDate);
    const priorAdjustments = usable.filter(
      (x) =>
        (x.type === "stock_split" || x.type === "reverse_split" || x.type === "symbol_change") &&
        Date.parse(x.effectiveDate) <= asOf
    );
    const ent = dividendEntitlement(applyActions(lots, priorAdjustments), a, opts);
    if (ent.sharesHeld <= 0) continue; // held nothing on the record date
    out.push({
      symbol: ent.symbol,
      corporateActionId: ent.corporateActionId,
      amountPerShare: ent.amountPerShare,
      sharesHeld: ent.sharesHeld,
      grossAmount: ent.grossAmount,
      netAmount: ent.netAmount,
      exDate: a.effectiveDate,
      recordDate: a.recordDate ?? null,
      paymentDate: a.paymentDate ?? null,
    });
  }
  return out;
}

/**
 * Record a buy as a new lot. Buys never touch existing lots — that is the
 * whole point of lot accounting: two purchases of the same symbol at different
 * prices stay distinguishable for tax purposes.
 */
export function recordBuy(params: {
  id: string;
  userId: string;
  symbol: string;
  quantity: number;
  costBasis: number;
  acquiredAt?: string;
  orderId?: string;
  provenance?: TradeLot["provenance"];
}): TradeLot {
  if (!(params.quantity > 0)) throw new Error("buy quantity must be positive");
  if (!(params.costBasis >= 0)) throw new Error("buy cost basis cannot be negative");
  return {
    id: params.id,
    userId: params.userId,
    symbol: params.symbol,
    quantity: params.quantity,
    costBasis: round2(params.costBasis),
    acquiredAt: params.acquiredAt ?? new Date().toISOString(),
    status: "open",
    provenance: params.provenance ?? "execution",
  };
}

/** Apply a sell against the ledger. Re-exported so callers touch one module. */
export function recordSell(
  lots: TradeLot[],
  symbol: string,
  quantity: number,
  proceeds: number,
  method: LotMethod = "fifo"
) {
  return applySale(lots, symbol, quantity, proceeds, method);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
