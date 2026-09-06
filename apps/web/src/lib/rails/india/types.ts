import type { Money } from "@/lib/money/money";

// ---------------------------------------------------------------------------
// India fiat rails: UPI, IMPS, NEFT, RTGS.
//
// WHAT THIS FILE IS. Interfaces and a settlement model. It contains no
// provider, no bank, no credentials and no live path, because FurlPay has none
// of those. It exists so that when a partner IS signed, the shape it plugs into
// is already correct — and so that nothing in the codebase can pretend the rail
// is live before then.
//
// WHAT FURLPAY CANNOT DO, STATED ONCE, HERE. It cannot connect to UPI, IMPS,
// NEFT or RTGS. Those are operated through member banks and authorised payment
// system participants. A fintech reaches them through a regulated intermediary
// — a bank, or an authorised payment aggregator under the RBI (Regulation of
// Payment Aggregators) Directions, 2025, which require customer funds to sit in
// an escrow account with a scheduled commercial bank and be settled to the
// merchant by T+1. "Integrating NPCI" is not a thing a startup does, and any
// diagram that draws that arrow is describing something that will not be built.
//
// THE DISTINCTION THE WHOLE FILE IS ORGANISED AROUND. Four different events
// get called "the payment went through", and they are separated by hours and by
// legal effect:
//
//   INITIATION      we asked. Nothing has moved.
//   ACKNOWLEDGEMENT the rail accepted the instruction. Still nothing final.
//   CONFIRMATION    the payer's bank debited / the payee's bank credited. The
//                   customer sees it in their app. NOT irrevocable.
//   SETTLEMENT      inter-bank settlement completed and the funds are in the
//                   escrow account. This is the only one that may be spent.
//
// Crediting a customer at CONFIRMATION is the most expensive mistake available
// on these rails, because inbound credits can still be recalled afterwards.
// `RailEvent.stage` makes the distinction unavoidable at every call site.
// ---------------------------------------------------------------------------

export type IndiaRail = "upi" | "imps" | "neft" | "rtgs";

/**
 * Operating characteristics, as published by the operators.
 *
 * Advisory. A rail being open does not mean a partner is processing, and this
 * table must never be read as availability — only as "if it were live, this is
 * how it would behave".
 */
export const RAIL_CHARACTERISTICS: Record<
  IndiaRail,
  {
    readonly availability: "24x7" | "banking_hours";
    readonly settlement: "near_real_time" | "batch" | "real_time_gross";
    /** Regulatory/scheme floor and ceiling, in paise. null = no scheme cap. */
    readonly minMinor: bigint;
    readonly maxMinor: bigint | null;
    readonly note: string;
  }
> = {
  upi: {
    availability: "24x7",
    settlement: "near_real_time",
    minMinor: 100n,
    maxMinor: null,
    note:
      "Per-transaction and daily caps are set by the payer's bank and the merchant category, not by " +
      "us, and they differ per bank. Never hardcode a UPI limit — read it from the partner.",
  },
  imps: {
    availability: "24x7",
    settlement: "near_real_time",
    minMinor: 100n,
    maxMinor: null,
    note: "Bank-set ceilings apply per channel.",
  },
  neft: {
    availability: "24x7",
    settlement: "batch",
    minMinor: 100n,
    maxMinor: null,
    note:
      "Settles in half-hourly batches. A NEFT credit confirmed near a batch boundary can be " +
      "acknowledged well before it settles — the gap is the whole reason `stage` exists.",
  },
  rtgs: {
    availability: "banking_hours",
    settlement: "real_time_gross",
    minMinor: 20_000_000n, // ₹2,00,000 scheme minimum
    maxMinor: null,
    note: "Gross settlement, so confirmation and settlement are close together. Minimum ₹2 lakh.",
  },
};

/** How far along the rail an event says the money is. */
export type RailStage = "initiated" | "acknowledged" | "confirmed" | "settled" | "returned" | "failed";

export interface RailEvent {
  readonly rail: IndiaRail;
  readonly stage: RailStage;
  /**
   * The rail's own reference. UTR for IMPS/NEFT/RTGS; RRN for UPI.
   *
   * This is the identifier a bank's operations desk can search on, so it is
   * what every dispute, recall and reconciliation is conducted with. A movement
   * without one cannot be traced and must not be treated as evidence.
   */
  readonly railRef?: string;
  readonly amount: Money;
  /** When the RAIL says it happened, not when we heard about it. */
  readonly occurredAt: string;
  /** Rail/partner return code, kept verbatim. */
  readonly statusCode?: string;
  readonly failureReason?: string;
}

/**
 * May funds at this stage be treated as available to the customer?
 *
 * `settled` only. Deliberately one line and deliberately exhaustive, so a new
 * stage cannot be added without someone deciding which side of this it falls
 * on.
 */
export function isSpendable(stage: RailStage): boolean {
  return stage === "settled";
}

/** A collection reference the customer pushes funds to. */
export interface CollectionReference {
  readonly rail: IndiaRail;
  /** Rendered to the customer. Shape differs per rail; never parsed by us. */
  readonly fields: Readonly<Record<string, string>>;
  readonly expectedAmount: Money;
  readonly expiresAt: string;
  /** The partner's id for this reference — what inbound events quote back. */
  readonly partnerRef: string;
}

/** A verified payout destination. */
export interface IndiaBeneficiary {
  readonly beneficiaryRef: string;
  readonly rail: IndiaRail;
  /** Account+IFSC for IMPS/NEFT/RTGS, VPA for UPI. Held by the partner. */
  readonly maskedDestination: string;
  /**
   * How the account was proven to exist and belong to the named holder.
   *
   * `unverified` is a refusal condition, not a warning. Paying out to an
   * account nobody has checked is how a substituted beneficiary gets paid, and
   * the substitution happens before this record is written.
   */
  readonly verification: "penny_drop" | "name_match" | "unverified";
  readonly resolvedName?: string;
  readonly verifiedAt?: string;
}

/**
 * The India rail port.
 *
 * Every method returns a `RailEvent` carrying a `stage`, so no implementation
 * can return a bare success. There is no adapter for this interface in the
 * repository, and `indiaRailAdapter()` returns null until one is contracted.
 */
export interface IndiaRailAdapter {
  readonly partnerId: string;
  readonly rails: readonly IndiaRail[];

  createCollectionReference(request: {
    userRef: string;
    amount: Money;
    rail: IndiaRail;
    expiresInSeconds: number;
  }): Promise<CollectionReference>;

  /** Pull the authoritative status. Never trust an unpolled webhook alone. */
  getCollectionStatus(partnerRef: string): Promise<RailEvent>;

  verifyBeneficiary(request: {
    userRef: string;
    rail: IndiaRail;
    fields: Readonly<Record<string, string>>;
    expectedName: string;
  }): Promise<IndiaBeneficiary>;

  payout(request: {
    orderId: string;
    idempotencyKey: string;
    beneficiaryRef: string;
    amount: Money;
    rail: IndiaRail;
    narration: string;
  }): Promise<RailEvent>;

  getPayoutStatus(partnerRef: string): Promise<RailEvent>;

  /** The escrow/settlement account's own record — reconciliation input. */
  getStatement(fromIso: string, toIso: string): Promise<readonly RailEvent[]>;
}

export class IndiaRailUnavailable extends Error {
  constructor(detail?: string) {
    super(
      detail ??
        "No India rail partner is configured. FurlPay cannot reach UPI, IMPS, NEFT or RTGS directly — " +
          "those require a bank or an RBI-authorised payment aggregator, with customer funds held in " +
          "escrow at a scheduled commercial bank. Until such an agreement exists and its credentials " +
          "are provisioned, every INR path fails closed."
    );
    this.name = "IndiaRailUnavailable";
  }
}

/**
 * Resolve the configured adapter.
 *
 * Returns null, always, today. It is a function rather than a constant so the
 * day a partner exists the change is one registration here, and every caller
 * already handles the null.
 */
export function indiaRailAdapter(): IndiaRailAdapter | null {
  return null;
}

/** Throwing variant, for paths where absence is an error worth a stack. */
export function requireIndiaRail(): IndiaRailAdapter {
  const adapter = indiaRailAdapter();
  if (!adapter) throw new IndiaRailUnavailable();
  return adapter;
}
