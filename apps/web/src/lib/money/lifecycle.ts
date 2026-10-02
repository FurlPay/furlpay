// ---------------------------------------------------------------------------
// The financial transaction lifecycle.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: an HTTP 200 is not a settlement.
//
// A provider returning `{"status":"success"}` means the provider accepted the
// instruction. It does not mean the bank moved money, it does not mean the
// chain reached finality, and it certainly does not mean the customer can
// spend. Systems that collapse those into one boolean pay out twice, or credit
// a deposit that is later recalled, and they cannot tell you which — because
// by then the distinction was never recorded.
//
// So every money movement is a state machine with EXPLICIT transitions, and
// the terminal success state is reachable only through states that carry
// evidence. `requireEvidence` below is what makes that structural rather than
// a convention somebody remembers.
//
// TWO LIFECYCLES, ONE VOCABULARY. On-ramp (fiat in, crypto out) and off-ramp
// (crypto in, fiat out) traverse the same states in different orders, and the
// transition table is per-flow. Sharing the vocabulary means one reconciliation
// query, one ops console and one alerting rule covers both; sharing the TABLE
// would let an off-ramp skip the chain leg, which is the specific mistake this
// design is guarding against.
// ---------------------------------------------------------------------------

export type FlowKind =
  | "onramp" // fiat -> crypto
  | "offramp" // crypto -> fiat
  | "crypto_deposit"
  | "crypto_withdrawal"
  | "fiat_deposit"
  | "fiat_withdrawal"
  | "internal_transfer"
  | "card_authorization"
  | "refund"
  | "chargeback"
  /**
   * A provider-hosted ramp checkout (Coinbase, Transak widget). The provider
   * takes the payment and delivers the crypto; FurlPay never holds the funds,
   * so there is no SETTLED leg and no ledger entry to point at. Completion is
   * evidenced by the delivery transaction itself, verified on-chain by FurlPay
   * (FLOW_EVIDENCE below) — never by the provider saying "completed".
   *
   * Stored in KV ramp orders (lib/ramp/rampOrder.ts) only. Migration 0014's
   * financial_transactions.flow_kind CHECK does not list it; persisting a
   * hosted order there needs a migration first.
   */
  | "hosted_checkout";

export type TxState =
  /** Intent recorded. Nothing has been promised to anyone. */
  | "CREATED"
  /** A price was quoted and is time-bound. Still nothing moved. */
  | "QUOTED"
  /** Held for a compliance decision. Blocks progress; never auto-clears. */
  | "COMPLIANCE_REVIEW"
  /** A human must look. Distinct from COMPLIANCE_REVIEW: this is ops, not AML. */
  | "MANUAL_REVIEW"
  /** Waiting for the customer / their bank to pay us. */
  | "PAYMENT_PENDING"
  /**
   * The payer's side reports the payment as made.
   *
   * NOT settled. On UPI/IMPS the network confirming a transfer and the money
   * being irrevocably ours are different events separated by a settlement
   * cycle, and inbound payments can still be recalled. Anything that spends
   * against this state is spending money it may not have.
   */
  | "PAYMENT_CONFIRMED"
  /** Provider/bank is settling to our account. */
  | "SETTLEMENT_PENDING"
  /** The funds are actually ours and available. This is what may be spent. */
  | "SETTLED"
  /** An on-chain transaction is broadcast but not final. */
  | "CRYPTO_PENDING"
  /** On-chain finality reached at the depth this amount requires. */
  | "CRYPTO_CONFIRMED"
  /** Off-ramp: the provider is processing the fiat payout. */
  | "PROVIDER_PENDING"
  /** Off-ramp: the beneficiary bank is crediting. */
  | "BANK_PENDING"
  /** Terminal success. Requires the evidence its flow demands. */
  | "COMPLETED"
  /** Terminal failure, nothing moved. */
  | "FAILED"
  /** Customer or system cancelled before anything moved. */
  | "CANCELLED"
  /** Money moved and was sent back by a compensating movement. */
  | "REVERSED"
  /** Value was returned to the payer through the refund flow. */
  | "REFUNDED"
  /**
   * Submitted, unresolved past its deadline, and no longer being waited on.
   *
   * Terminal but NOT a failure: funds may have moved. This exists because the
   * alternative — leaving it pending forever — has no owner, and a client
   * polls an outcome that will never arrive while nobody is paged.
   */
  | "ABANDONED";

export const TERMINAL_STATES: readonly TxState[] = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "REVERSED",
  "REFUNDED",
  "ABANDONED",
];

export function isTerminal(state: TxState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** States in which the customer's value is committed and cannot be re-spent. */
export const RESERVED_STATES: readonly TxState[] = [
  "PAYMENT_CONFIRMED",
  "SETTLEMENT_PENDING",
  "SETTLED",
  "CRYPTO_PENDING",
  "CRYPTO_CONFIRMED",
  "PROVIDER_PENDING",
  "BANK_PENDING",
];

// ── Evidence ───────────────────────────────────────────────────────────────

/**
 * What a state must be able to point at.
 *
 * This is the mechanism that stops "the API said OK" becoming COMPLETED. A
 * transition into a state listed here is refused unless the named reference is
 * present, so a caller cannot mark a withdrawal complete without a payout
 * reference from the party that actually moved the money.
 */
export type EvidenceKind = "providerRef" | "chainTxHash" | "bankRef" | "ledgerTxId";

export const REQUIRED_EVIDENCE: Partial<Record<TxState, readonly EvidenceKind[]>> = {
  PAYMENT_CONFIRMED: ["providerRef"],
  SETTLED: ["ledgerTxId"],
  CRYPTO_PENDING: ["chainTxHash"],
  CRYPTO_CONFIRMED: ["chainTxHash"],
  PROVIDER_PENDING: ["providerRef"],
  BANK_PENDING: ["bankRef"],
  COMPLETED: ["ledgerTxId"],
  REFUNDED: ["ledgerTxId"],
  REVERSED: ["ledgerTxId"],
};

export interface TxReferences {
  /** Our own idempotency key, supplied by the caller. */
  readonly idempotencyKey?: string;
  /** The provider's id for this movement. */
  readonly providerRef?: string;
  /** The bank/rail reference — UTR for IMPS/NEFT/RTGS, RRN for UPI. */
  readonly bankRef?: string;
  /** On-chain transaction hash, once broadcast. */
  readonly chainTxHash?: string;
  /** The balanced ledger entry that recorded this. */
  readonly ledgerTxId?: string;
  /** Anything a counterparty gave us that does not fit above. */
  readonly externalRef?: string;
}

// ── Transition tables ──────────────────────────────────────────────────────
//
// One table per flow. Written out rather than derived, because the point is
// that somebody had to think about each arrow — a generated table would permit
// whatever the generator's rule happened to allow.

type Table = Partial<Record<TxState, readonly TxState[]>>;

const REVIEW_EXITS = ["COMPLIANCE_REVIEW", "MANUAL_REVIEW", "FAILED", "CANCELLED"] as const;

const ONRAMP: Table = {
  CREATED: ["QUOTED", "COMPLIANCE_REVIEW", "CANCELLED", "FAILED"],
  QUOTED: ["PAYMENT_PENDING", "COMPLIANCE_REVIEW", "CANCELLED", "FAILED"],
  COMPLIANCE_REVIEW: ["QUOTED", "PAYMENT_PENDING", "MANUAL_REVIEW", "FAILED", "CANCELLED"],
  MANUAL_REVIEW: ["PAYMENT_PENDING", "SETTLEMENT_PENDING", "CRYPTO_PENDING", "FAILED", "REFUNDED"],
  PAYMENT_PENDING: ["PAYMENT_CONFIRMED", ...REVIEW_EXITS, "ABANDONED"],
  // Confirmed -> settled is the gap where a recall happens. REVERSED is
  // reachable from here on purpose.
  PAYMENT_CONFIRMED: ["SETTLEMENT_PENDING", "COMPLIANCE_REVIEW", "MANUAL_REVIEW", "REVERSED", "REFUNDED", "FAILED"],
  SETTLEMENT_PENDING: ["SETTLED", "MANUAL_REVIEW", "REVERSED", "REFUNDED", "FAILED", "ABANDONED"],
  // Only once the fiat is genuinely ours do we buy and send the crypto.
  SETTLED: ["CRYPTO_PENDING", "MANUAL_REVIEW", "REFUNDED"],
  CRYPTO_PENDING: ["CRYPTO_CONFIRMED", "MANUAL_REVIEW", "FAILED", "ABANDONED"],
  CRYPTO_CONFIRMED: ["COMPLETED", "MANUAL_REVIEW"],
  COMPLETED: ["REFUNDED", "REVERSED"],
};

const OFFRAMP: Table = {
  CREATED: ["QUOTED", "COMPLIANCE_REVIEW", "CANCELLED", "FAILED"],
  QUOTED: ["COMPLIANCE_REVIEW", "CRYPTO_PENDING", "CANCELLED", "FAILED"],
  COMPLIANCE_REVIEW: ["QUOTED", "CRYPTO_PENDING", "MANUAL_REVIEW", "FAILED", "CANCELLED"],
  MANUAL_REVIEW: ["CRYPTO_PENDING", "PROVIDER_PENDING", "BANK_PENDING", "FAILED", "REVERSED"],
  CRYPTO_PENDING: ["CRYPTO_CONFIRMED", "MANUAL_REVIEW", "FAILED", "ABANDONED"],
  // THE ARROW THAT MATTERS: crypto confirmed does NOT go to COMPLETED. The
  // customer wanted rupees. Until a bank credits them, this is not done.
  CRYPTO_CONFIRMED: ["PROVIDER_PENDING", "MANUAL_REVIEW"],
  PROVIDER_PENDING: ["BANK_PENDING", "MANUAL_REVIEW", "FAILED", "REVERSED", "ABANDONED"],
  BANK_PENDING: ["COMPLETED", "MANUAL_REVIEW", "FAILED", "REVERSED", "ABANDONED"],
  COMPLETED: ["REVERSED"],
};

const CRYPTO_IN: Table = {
  CREATED: ["CRYPTO_PENDING", "COMPLIANCE_REVIEW", "FAILED"],
  COMPLIANCE_REVIEW: ["CRYPTO_PENDING", "MANUAL_REVIEW", "FAILED"],
  MANUAL_REVIEW: ["CRYPTO_CONFIRMED", "SETTLED", "FAILED", "REVERSED"],
  CRYPTO_PENDING: ["CRYPTO_CONFIRMED", "MANUAL_REVIEW", "FAILED", "ABANDONED"],
  // Screen the SOURCE before crediting. A confirmed deposit from a sanctioned
  // or mixer-adjacent address is confirmed and must not be credited.
  CRYPTO_CONFIRMED: ["COMPLIANCE_REVIEW", "SETTLED", "MANUAL_REVIEW"],
  SETTLED: ["COMPLETED", "MANUAL_REVIEW"],
  COMPLETED: ["REVERSED"],
};

const CRYPTO_OUT: Table = {
  CREATED: ["COMPLIANCE_REVIEW", "CRYPTO_PENDING", "CANCELLED", "FAILED"],
  COMPLIANCE_REVIEW: ["CRYPTO_PENDING", "MANUAL_REVIEW", "FAILED", "CANCELLED"],
  MANUAL_REVIEW: ["CRYPTO_PENDING", "FAILED", "REVERSED"],
  CRYPTO_PENDING: ["CRYPTO_CONFIRMED", "MANUAL_REVIEW", "FAILED", "ABANDONED"],
  CRYPTO_CONFIRMED: ["COMPLETED", "MANUAL_REVIEW"],
  COMPLETED: ["REVERSED"],
};

const FIAT_IN: Table = {
  CREATED: ["PAYMENT_PENDING", "COMPLIANCE_REVIEW", "CANCELLED", "FAILED"],
  COMPLIANCE_REVIEW: ["PAYMENT_PENDING", "MANUAL_REVIEW", "FAILED", "CANCELLED"],
  MANUAL_REVIEW: ["SETTLEMENT_PENDING", "SETTLED", "FAILED", "REFUNDED"],
  PAYMENT_PENDING: ["PAYMENT_CONFIRMED", "FAILED", "CANCELLED", "ABANDONED"],
  PAYMENT_CONFIRMED: ["SETTLEMENT_PENDING", "COMPLIANCE_REVIEW", "MANUAL_REVIEW", "REVERSED", "FAILED"],
  SETTLEMENT_PENDING: ["SETTLED", "MANUAL_REVIEW", "REVERSED", "FAILED", "ABANDONED"],
  SETTLED: ["COMPLETED", "MANUAL_REVIEW", "REVERSED"],
  COMPLETED: ["REVERSED", "REFUNDED"],
};

const FIAT_OUT: Table = {
  CREATED: ["COMPLIANCE_REVIEW", "PROVIDER_PENDING", "CANCELLED", "FAILED"],
  COMPLIANCE_REVIEW: ["PROVIDER_PENDING", "MANUAL_REVIEW", "FAILED", "CANCELLED"],
  MANUAL_REVIEW: ["PROVIDER_PENDING", "BANK_PENDING", "FAILED", "REVERSED"],
  PROVIDER_PENDING: ["BANK_PENDING", "MANUAL_REVIEW", "FAILED", "REVERSED", "ABANDONED"],
  BANK_PENDING: ["COMPLETED", "MANUAL_REVIEW", "FAILED", "REVERSED", "ABANDONED"],
  COMPLETED: ["REVERSED"],
};

const SIMPLE: Table = {
  CREATED: ["COMPLIANCE_REVIEW", "SETTLED", "FAILED", "CANCELLED"],
  COMPLIANCE_REVIEW: ["SETTLED", "MANUAL_REVIEW", "FAILED", "CANCELLED"],
  MANUAL_REVIEW: ["SETTLED", "FAILED", "REVERSED"],
  SETTLED: ["COMPLETED", "REVERSED"],
  COMPLETED: ["REVERSED", "REFUNDED"],
};

const CARD: Table = {
  CREATED: ["COMPLIANCE_REVIEW", "SETTLED", "FAILED"],
  COMPLIANCE_REVIEW: ["SETTLED", "MANUAL_REVIEW", "FAILED"],
  MANUAL_REVIEW: ["SETTLED", "FAILED", "REVERSED"],
  SETTLED: ["COMPLETED", "REVERSED", "REFUNDED"],
  COMPLETED: ["REVERSED", "REFUNDED"],
};

// Hosted checkout: the provider owns the payment leg. PAYMENT_CONFIRMED needs
// the provider's order id; CRYPTO_PENDING needs the delivery tx hash;
// CRYPTO_CONFIRMED and COMPLETED are set only after FurlPay verified that tx
// on-chain. Refunds happen on the provider's side and are recorded as a
// provider status, not as a FurlPay state (there is no FurlPay ledger leg).
const HOSTED: Table = {
  CREATED: ["PAYMENT_PENDING", "CANCELLED", "FAILED"],
  PAYMENT_PENDING: ["PAYMENT_CONFIRMED", "COMPLIANCE_REVIEW", "FAILED", "CANCELLED", "ABANDONED"],
  COMPLIANCE_REVIEW: ["PAYMENT_PENDING", "PAYMENT_CONFIRMED", "MANUAL_REVIEW", "FAILED", "CANCELLED"],
  PAYMENT_CONFIRMED: ["CRYPTO_PENDING", "COMPLIANCE_REVIEW", "MANUAL_REVIEW", "FAILED"],
  CRYPTO_PENDING: ["CRYPTO_CONFIRMED", "MANUAL_REVIEW", "FAILED", "ABANDONED"],
  CRYPTO_CONFIRMED: ["COMPLETED", "MANUAL_REVIEW"],
  MANUAL_REVIEW: ["PAYMENT_CONFIRMED", "CRYPTO_PENDING", "CRYPTO_CONFIRMED", "FAILED", "ABANDONED"],
};

const TABLES: Record<FlowKind, Table> = {
  onramp: ONRAMP,
  offramp: OFFRAMP,
  crypto_deposit: CRYPTO_IN,
  crypto_withdrawal: CRYPTO_OUT,
  fiat_deposit: FIAT_IN,
  fiat_withdrawal: FIAT_OUT,
  internal_transfer: SIMPLE,
  card_authorization: CARD,
  refund: SIMPLE,
  chargeback: SIMPLE,
  hosted_checkout: HOSTED,
};

// ── The guard ──────────────────────────────────────────────────────────────

export class TransitionError extends Error {
  readonly flow: FlowKind;
  readonly from: TxState;
  readonly to: TxState;
  readonly reason: "not_allowed" | "terminal" | "missing_evidence";

  constructor(
    flow: FlowKind,
    from: TxState,
    to: TxState,
    reason: TransitionError["reason"],
    detail: string
  ) {
    super(detail);
    this.name = "TransitionError";
    this.flow = flow;
    this.from = from;
    this.to = to;
    this.reason = reason;
  }
}

export function allowedNextStates(flow: FlowKind, from: TxState): readonly TxState[] {
  return TABLES[flow][from] ?? [];
}

export function canTransition(flow: FlowKind, from: TxState, to: TxState): boolean {
  return allowedNextStates(flow, from).includes(to);
}

/** Which evidence a state needs but the supplied references do not carry. */
/**
 * Per-flow replacements for REQUIRED_EVIDENCE. Only where a flow's terminal
 * proof genuinely differs: a hosted checkout has no FurlPay ledger leg, so its
 * completion is proven by the delivery transaction, not by a ledger id.
 */
export const FLOW_EVIDENCE: Partial<Record<FlowKind, Partial<Record<TxState, readonly EvidenceKind[]>>>> = {
  hosted_checkout: { COMPLETED: ["chainTxHash"] },
};

export function missingEvidence(to: TxState, refs: TxReferences, flow?: FlowKind): EvidenceKind[] {
  const required = (flow && FLOW_EVIDENCE[flow]?.[to]) ?? REQUIRED_EVIDENCE[to] ?? [];
  return required.filter((kind) => {
    const value = refs[kind];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

/**
 * Assert a transition, or throw.
 *
 * Three refusals, in the order that gives the most useful error:
 *   1. The current state is terminal. A terminal record is history; changing it
 *      destroys the audit trail. Corrections are new compensating movements.
 *   2. The arrow is not in the table for this flow.
 *   3. The destination requires evidence the caller did not bring — the check
 *      that keeps "the API returned 200" from becoming COMPLETED.
 */
export function assertTransition(
  flow: FlowKind,
  from: TxState,
  to: TxState,
  refs: TxReferences = {}
): void {
  // COMPLETED -> REVERSED / REFUNDED is a real correction and is in the tables,
  // so terminality is checked against the table rather than blanket-refused.
  if (isTerminal(from) && !canTransition(flow, from, to)) {
    throw new TransitionError(
      flow,
      from,
      to,
      "terminal",
      `${flow}: ${from} is terminal; record a compensating movement instead of moving it to ${to}.`
    );
  }

  if (!canTransition(flow, from, to)) {
    const allowed = allowedNextStates(flow, from);
    throw new TransitionError(
      flow,
      from,
      to,
      "not_allowed",
      `${flow}: ${from} -> ${to} is not a permitted transition. Allowed: ${
        allowed.length ? allowed.join(", ") : "(none)"
      }.`
    );
  }

  const missing = missingEvidence(to, refs, flow);
  if (missing.length > 0) {
    throw new TransitionError(
      flow,
      from,
      to,
      "missing_evidence",
      `${flow}: ${to} requires ${missing.join(", ")}. A provider's HTTP 200 is not evidence that money moved.`
    );
  }
}
