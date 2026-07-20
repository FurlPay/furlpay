// ---------------------------------------------------------------------------
// Corporate actions & tax lots — domain types.
//
// WHY THIS EXISTS: portfolio state is currently a MUTABLE AGGREGATE. A buy does
// `holding.shares += qty; holding.costBasis += notional`, and a sell scales the
// basis by a fraction (order/route.ts). That is average-cost accounting with no
// history, and it makes corporate actions unimplementable:
//
//   - A 2:1 split has to mutate shares AND basis with no record of the before.
//   - A dividend cannot know how many shares were held on the record date.
//   - A sale cannot report which lots closed, so realized gain and holding
//     period (short vs long term) are unknowable.
//
// The fix is an immutable trade log projected into positions, not a number
// edited in place. Lots are append-only; a corporate action produces NEW lots
// that supersede old ones rather than overwriting them, so any historical
// position can be reconstructed and any adjustment can be audited.
// ---------------------------------------------------------------------------

export type CorporateActionType =
  | "cash_dividend"
  | "stock_dividend"
  | "stock_split"
  | "reverse_split"
  | "symbol_change"
  | "merger"
  | "acquisition"
  | "spin_off"
  | "rights_issue"
  | "delisting";

/** Announced actions can be revised or cancelled before they settle; the
 *  confidence level records which stage a row reflects. */
export type ActionConfidence = "announced" | "confirmed" | "corrected";

export interface CorporateAction {
  id: string;
  symbol: string;
  type: CorporateActionType;
  /** The date the action takes effect (splits) or the ex-date (dividends). */
  effectiveDate: string;
  recordDate?: string;
  paymentDate?: string;
  /**
   * Split/stock-dividend ratio expressed as new-for-old.
   *   2-for-1 split      → 2
   *   1-for-10 reverse   → 0.1
   * Kept as a plain number rather than a fraction pair because every consumer
   * multiplies by it; the parsing of "2:1" strings belongs at the ingest edge.
   */
  ratio?: number;
  /** Cash dividend amount PER SHARE, in the asset's currency. */
  amountPerShare?: number;
  /** symbol_change / merger: the ticker holders end up with. */
  newSymbol?: string;
  source: "alpaca" | "manual" | "seed";
  confidence: ActionConfidence;
  /** Set when this row corrects an earlier announcement. */
  supersedes?: string;
  /**
   * Reorganization terms. Persisted in the `metadata` JSONB column rather than
   * as columns, because only three action types use them and each uses a
   * different subset. Absent for splits and dividends.
   */
  terms?: ReorgTerms;
}

/**
 * The economic terms of a reorganization — the inputs that decide whether an
 * event is taxable and how basis moves. Kept as an explicit type rather than a
 * `Record<string, unknown>` bag: every field here changes someone's tax bill,
 * and a typo in a metadata key must not silently become a zero.
 */
export interface ReorgTerms {
  /** Merger: cash paid per OLD share. Present → the deal has a taxable leg. */
  cashPerShare?: number;
  /** Merger: value of one NEW share, required only for mixed cash+stock deals
   *  where basis must be apportioned between the two legs. */
  stockValuePerShare?: number;
  /** Spin-off: parent per-share FMV immediately after distribution. */
  parentFmv?: number;
  /** Spin-off: child per-share FMV immediately after distribution. */
  childFmv?: number;
  /** Delisting: liquidating distribution per share. Absent → the position
   *  freezes instead of closing. Zero is meaningful (worthless-security
   *  writeoff) and is NOT the same as absent. */
  liquidationPerShare?: number;
  /** Whether fractional entitlements are paid out as cash. */
  cashInLieuOfFractional?: boolean;
}

/**
 * Lot lifecycle.
 *
 *   open            tradeable, counts toward the position
 *   closed          sold, or cashed out entirely by a reverse split
 *   split_adjusted  replaced by a split (the historical name — see below)
 *   superseded      replaced by a merger or spin-off
 *   frozen          issuer delisted. STILL OWNED: basis and holding period
 *                   survive and a liquidating distribution may follow, but the
 *                   position cannot be traded and must not be priced off a
 *                   stale quote. Closing it would realize a gain that never
 *                   happened.
 */
export type LotStatus = "open" | "closed" | "split_adjusted" | "superseded" | "frozen";

/**
 * Statuses meaning "this lot was replaced by a corporate action" — it is
 * history, not a holding, and must never be counted in a position or paid a
 * dividend.
 *
 * Two names for one idea is not an accident: `split_adjusted` predates mergers
 * and spin-offs and is retained so existing rows and the split path stay valid
 * (migration 0007). Every consumer checks THIS SET rather than either literal,
 * so the distinction lives in exactly one place.
 */
export const SUPERSEDED_STATUSES: ReadonlySet<LotStatus> = new Set([
  "split_adjusted",
  "superseded",
]);

/** True when a lot is history rather than a holding. */
export function isSuperseded(lot: Pick<TradeLot, "status">): boolean {
  return SUPERSEDED_STATUSES.has(lot.status);
}

/**
 * Where a lot came from — a first-class field, not an id-naming convention.
 *
 *   execution        a real fill; `acquiredAt` is observed fact
 *   backfill         reconstructed from the legacy `holdings` aggregate. The
 *                    date is an ESTIMATE and the blended basis cannot be split
 *                    into the real purchases, so holding period and FIFO order
 *                    are approximations — never report these as tax fact
 *   corporate_action produced by a split/merger adjustment
 *   seed             demo/fixture data
 */
export type LotProvenance = "execution" | "backfill" | "corporate_action" | "seed";

/**
 * One acquisition of shares at a known price and time — the atom of tax
 * accounting. NEVER mutated after a corporate action: the old lot is marked
 * `split_adjusted` and a replacement lot is written pointing back at it via
 * `sourceLotId`, so the adjustment is auditable.
 */
export interface TradeLot {
  id: string;
  userId: string;
  symbol: string;
  /** Shares remaining in this lot (a partial sell reduces this). */
  quantity: number;
  /** Total cost of the REMAINING quantity, not of the original purchase. */
  costBasis: number;
  /** Acquisition time — drives FIFO ordering and the holding period. */
  acquiredAt: string;
  status: LotStatus;
  /** Defaults to "execution" when absent (pre-provenance rows). */
  provenance?: LotProvenance;
  /** Set on lots created by a split/merger: the lot this one replaced. */
  sourceLotId?: string;
  /** Set on lots created by dividend reinvestment. */
  fromCorporateActionId?: string;
  /**
   * Spin-off only: the fraction of the parent lot's basis allocated here, by
   * FMV ratio on the distribution date. Recorded because the FMVs used at the
   * time vanish from every live feed within weeks, and a basis allocation that
   * cannot be re-derived cannot be defended to a tax authority.
   */
  basisAllocationPct?: number;
}

/** Cost-basis method used to choose which lots a sale consumes.
 *  US default for equities is FIFO unless the holder elects otherwise. */
export type LotMethod = "fifo" | "lifo" | "hifo";

export interface RealizedSale {
  /** Lots consumed, with how much of each was used. */
  consumed: { lotId: string; quantity: number; costBasis: number }[];
  proceeds: number;
  costBasis: number;
  /** proceeds − costBasis. Negative is a realized loss. */
  realizedGain: number;
  /** Lots left over after the sale (open lots, with reduced quantities). */
  remaining: TradeLot[];
}

export interface DividendEntitlement {
  symbol: string;
  corporateActionId: string;
  /** Shares held on the record date — the basis of the whole calculation. */
  sharesHeld: number;
  amountPerShare: number;
  grossAmount: number;
  withholdingTax: number;
  netAmount: number;
}
