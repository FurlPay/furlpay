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
}

export type LotStatus = "open" | "closed" | "split_adjusted";

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
