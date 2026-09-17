import type { Money } from "@/lib/money/money";
import type { TxReferences, TxState } from "@/lib/money/lifecycle";

// ---------------------------------------------------------------------------
// The provider boundary.
//
// WHY THIS EXISTS. Benchmarking two shipping apps showed the same lesson from
// opposite directions: one wraps every provider behind its own backend façade
// and its own order ids; the other runs a server-side aggregator and hands the
// app an opaque `providerId`. Neither lets a provider's vocabulary leak into
// the product. The failure mode they are both avoiding is a codebase where
// `if (provider === "x")` appears in a hundred places, because at that point
// changing provider is a rewrite and losing one is an outage.
//
// SO: FurlPay owns the order, the state machine, the ledger and the customer
// relationship. A provider is a thing that can be ASKED to move money and then
// OBSERVED. It is never the source of truth for whether a customer has funds.
//
// THREE RULES THIS INTERFACE ENCODES:
//
//   1. QUOTE AND ORDER ARE SEPARATE. A quote is a price with an expiry and no
//      obligation. An order is a commitment. Collapsing them means every price
//      check is a potential charge.
//
//   2. STATUS IS PULLED, NOT ONLY PUSHED. Every adapter must implement
//      `getStatus`. A webhook is an optimisation; a webhook that never arrives
//      is normal, and a system that can only learn outcomes from webhooks has
//      transactions that hang forever.
//
//   3. AN ADAPTER MAPS, IT DOES NOT DECIDE. It translates the provider's
//      vocabulary into our TxState and returns evidence. It must never post to
//      the ledger, never mark anything COMPLETED, and never choose a fallback
//      provider — those are orchestration decisions and they live above this
//      line, where they can be reasoned about once.
// ---------------------------------------------------------------------------

export type ProviderId = string;

export type ProviderKind = "onramp" | "offramp" | "banking" | "custody" | "screening" | "issuing";

/** What an adapter reports back after any call that touches a provider. */
export interface ProviderOutcome {
  /** Our state machine's reading of the provider's status. */
  readonly state: TxState;
  /** Evidence for that reading. `assertTransition` enforces sufficiency. */
  readonly references: TxReferences;
  /** The provider's own status string, kept verbatim for support and audit. */
  readonly providerStatus: string;
  /** Provider-supplied failure reason, when it failed. */
  readonly failureReason?: string;
  /**
   * True when the provider says this is final and will not change.
   *
   * Distinct from `isTerminal(state)`: a provider can consider a payout final
   * while our flow still has a bank leg to wait on, and treating the provider's
   * "done" as ours is precisely the mistake that marks a withdrawal complete
   * before anyone has been paid.
   */
  readonly providerFinal: boolean;
  /** Raw payload, redacted by the adapter. Never credentials. */
  readonly raw?: Record<string, unknown>;
}

export class ProviderError extends Error {
  readonly providerId: ProviderId;
  readonly retryable: boolean;
  /**
   * True when the request may have been APPLIED despite the error — a timeout,
   * a 502, a dropped connection.
   *
   * This is the most important flag in the file. "Failed" and "unknown" are
   * different states and must not be collapsed: retrying an unknown write can
   * double-pay, and failing it can strand money. An indeterminate outcome must
   * reach a status poll, never a retry.
   */
  readonly indeterminate: boolean;

  constructor(
    providerId: ProviderId,
    message: string,
    opts: { retryable?: boolean; indeterminate?: boolean } = {}
  ) {
    super(message);
    this.name = "ProviderError";
    this.providerId = providerId;
    this.retryable = opts.retryable ?? false;
    this.indeterminate = opts.indeterminate ?? false;
  }
}

/** Thrown when a capability is asked of an adapter that does not have it. */
export class ProviderUnsupported extends ProviderError {
  constructor(providerId: ProviderId, capability: string) {
    super(providerId, `${providerId} does not support ${capability}.`);
    this.name = "ProviderUnsupported";
  }
}

// ── Shared request shapes ──────────────────────────────────────────────────

export interface QuoteRequest {
  readonly from: Money;
  /** Asset id we want out. The adapter prices from -> to. */
  readonly toAssetId: string;
  readonly paymentMethod: PaymentMethod;
  /** ISO-3166 alpha-2. Drives eligibility, not just formatting. */
  readonly countryCode: string;
  readonly userRef: string;
}

export interface Quote {
  readonly providerId: ProviderId;
  /** Opaque to us; handed back on order creation so the price is honoured. */
  readonly providerQuoteId: string;
  readonly from: Money;
  readonly to: Money;
  readonly fees: { readonly provider: Money; readonly network: Money; readonly platform: Money };
  /** Exact rate as a rational, never a float. */
  readonly rate: { readonly numerator: string; readonly denominator: string };
  readonly expiresAt: string;
}

export type PaymentMethod =
  | "upi"
  | "imps"
  | "neft"
  | "rtgs"
  | "bank_transfer"
  | "card"
  | "apple_pay"
  | "google_pay"
  | "sepa"
  | "ach"
  | "faster_payments"
  | "on_chain";

// ── On-ramp ────────────────────────────────────────────────────────────────

export interface OnrampOrderRequest {
  /** OUR order id. The provider is told about it; it does not mint it. */
  readonly orderId: string;
  readonly idempotencyKey: string;
  readonly quote: Quote;
  /** Where the crypto must land. Validated by the caller, not the adapter. */
  readonly destinationAddress: string;
  readonly destinationChain: string;
  readonly userRef: string;
  readonly countryCode: string;
  /** Where the provider returns the customer after a hosted flow. */
  readonly redirectUrl?: string;
}

export interface OnrampOrder {
  readonly providerId: ProviderId;
  readonly providerRef: string;
  readonly outcome: ProviderOutcome;
  /** Present when the customer must complete a hosted step. */
  readonly checkoutUrl?: string;
  /**
   * Present when the customer pays by pushing funds to a reference we give
   * them (a VPA, a virtual account). Display-only; never treated as received.
   */
  readonly collectionInstruction?: CollectionInstruction;
}

export interface CollectionInstruction {
  readonly method: PaymentMethod;
  /** e.g. a UPI VPA, or an account number + IFSC. Rendered, never parsed. */
  readonly fields: Readonly<Record<string, string>>;
  readonly expiresAt?: string;
  /** The exact amount that must be paid for auto-matching to work. */
  readonly expectedAmount: Money;
}

export interface OnrampProviderAdapter {
  readonly id: ProviderId;
  readonly kind: "onramp";
  quote(request: QuoteRequest): Promise<Quote>;
  createOrder(request: OnrampOrderRequest): Promise<OnrampOrder>;
  getStatus(providerRef: string): Promise<ProviderOutcome>;
  cancel(providerRef: string, reason: string): Promise<ProviderOutcome>;
  refund(providerRef: string, amount: Money, reason: string): Promise<ProviderOutcome>;
  /** Verify a webhook against THIS provider's documented scheme. */
  verifyWebhook(rawBody: string, headers: Readonly<Record<string, string>>): Promise<WebhookEvent>;
}

// ── Off-ramp ───────────────────────────────────────────────────────────────

export interface OfframpOrderRequest {
  readonly orderId: string;
  readonly idempotencyKey: string;
  readonly quote: Quote;
  /** Verified beneficiary. The adapter never resolves one from user input. */
  readonly beneficiaryRef: string;
  readonly userRef: string;
  readonly countryCode: string;
}

export interface OfframpOrder {
  readonly providerId: ProviderId;
  readonly providerRef: string;
  readonly outcome: ProviderOutcome;
  /**
   * Where WE must send the crypto for the provider to release fiat.
   *
   * Returned by the provider and screened by us before a single unit is sent:
   * an address handed to us by a third party is attacker-controlled from our
   * side of the trust boundary.
   */
  readonly depositAddress?: string;
  readonly depositChain?: string;
  readonly depositMemo?: string;
}

export interface OfframpProviderAdapter {
  readonly id: ProviderId;
  readonly kind: "offramp";
  quote(request: QuoteRequest): Promise<Quote>;
  createOrder(request: OfframpOrderRequest): Promise<OfframpOrder>;
  /** Tell the provider which on-chain transaction funds this order. */
  notifyDeposit(providerRef: string, chainTxHash: string): Promise<ProviderOutcome>;
  getStatus(providerRef: string): Promise<ProviderOutcome>;
  cancel(providerRef: string, reason: string): Promise<ProviderOutcome>;
  verifyWebhook(rawBody: string, headers: Readonly<Record<string, string>>): Promise<WebhookEvent>;
}

// ── Banking ────────────────────────────────────────────────────────────────

export interface BeneficiaryRequest {
  readonly userRef: string;
  readonly countryCode: string;
  /** Rail-specific fields. India: accountNumber+ifsc, or vpa. */
  readonly fields: Readonly<Record<string, string>>;
  readonly holderName: string;
}

export interface Beneficiary {
  readonly beneficiaryRef: string;
  /**
   * Whether the ACCOUNT was verified, and how.
   *
   * "penny_drop" and "name_match" are evidence; "unverified" means we do not
   * know the account exists or belongs to the person named. Paying an
   * unverified beneficiary is how money reaches a substituted account, so the
   * orchestrator refuses it rather than trusting the name the user typed.
   */
  readonly verification: "penny_drop" | "name_match" | "unverified";
  /** The name the BANK returned, which may differ from what the user typed. */
  readonly resolvedName?: string;
}

export interface PayoutRequest {
  readonly orderId: string;
  readonly idempotencyKey: string;
  readonly beneficiaryRef: string;
  readonly amount: Money;
  readonly method: PaymentMethod;
  readonly narration: string;
}

export interface StatementEntry {
  readonly bankRef: string;
  readonly postedAt: string;
  readonly amount: Money;
  readonly direction: "credit" | "debit";
  readonly counterparty?: string;
  readonly narration?: string;
}

export interface BankingProviderAdapter {
  readonly id: ProviderId;
  readonly kind: "banking";
  /** A reference the customer pushes funds to (VPA / virtual account). */
  createCollectionReference(request: {
    userRef: string;
    amount: Money;
    method: PaymentMethod;
    expiresInSeconds: number;
  }): Promise<CollectionInstruction & { providerRef: string }>;
  /** Confirm an inbound payment actually landed. Pull, not push. */
  verifyIncomingPayment(providerRef: string): Promise<ProviderOutcome>;
  createBeneficiary(request: BeneficiaryRequest): Promise<Beneficiary>;
  payout(request: PayoutRequest): Promise<ProviderOutcome>;
  getPayoutStatus(providerRef: string): Promise<ProviderOutcome>;
  /** The bank's own record for a window — the reconciliation input. */
  getStatement(from: string, to: string): Promise<StatementEntry[]>;
  verifyWebhook(rawBody: string, headers: Readonly<Record<string, string>>): Promise<WebhookEvent>;
}

// ── Webhooks ───────────────────────────────────────────────────────────────

export interface WebhookEvent {
  readonly providerId: ProviderId;
  /** The provider's event id — the idempotency key for delivery. */
  readonly eventId: string;
  /** OUR order id, resolved by the adapter from the payload. */
  readonly orderId?: string;
  readonly providerRef?: string;
  /** When the PROVIDER says it happened. Drives ordering, not arrival time. */
  readonly occurredAt: string;
  readonly outcome: ProviderOutcome;
}

export class WebhookVerificationError extends Error {
  readonly providerId: ProviderId;
  constructor(providerId: ProviderId, message: string) {
    super(message);
    this.name = "WebhookVerificationError";
    this.providerId = providerId;
  }
}

export type ProviderAdapter =
  | OnrampProviderAdapter
  | OfframpProviderAdapter
  | BankingProviderAdapter
  | CardIssuerProviderAdapter;

// ---------------------------------------------------------------------------
// Card issuing.
//
// docs/MAINNET_READINESS.md §11 records this as the gap: "Card abstraction for
// a future issuer | PARTIAL | Lifecycle service exists; not yet expressed as a
// provider port." This is the port.
//
// The same three rules above apply, and one more that is specific to cards:
//
//   4. THE ISSUER IS NEVER ASKED WHETHER THE CUSTOMER CAN AFFORD IT. A
//      just-in-time authorisation asks US, and we answer from our own ledger
//      and policy engine. An adapter that let the issuer's opinion of the
//      balance stand in for ours would put the customer's spendable funds
//      outside the system that reconciles them.
//
// Amounts are `Money` — integer minor units — for the reason lib/money/money.ts
// exists. A card authorisation arrives as an integer number of cents and must
// stay one.
// ---------------------------------------------------------------------------

export type CardFormFactor = "virtual" | "physical";

export type CardStatus = "active" | "frozen" | "closed" | "pending";

/** Spend controls attached to a card at issuance. */
export interface CardSpendControls {
  /** Hard ceiling per authorisation. */
  readonly perTransaction?: Money;
  /** Rolling limit over `limitWindow`. */
  readonly limit?: Money;
  readonly limitWindow?: "transaction" | "daily" | "weekly" | "monthly";
  /**
   * Merchant category codes this card may be used at. An EMPTY array means
   * "no merchant is allowed" and `undefined` means "unrestricted" — they are
   * different, and an adapter must not collapse them.
   */
  readonly allowedMccs?: readonly string[];
}

export interface IssueCardRequest {
  /** OUR id for the person or agent the card belongs to. */
  readonly holderRef: string;
  readonly formFactor: CardFormFactor;
  readonly currency: string;
  readonly controls: CardSpendControls;
  /** True for a single-use card — the travel VCN case. */
  readonly singleUse: boolean;
  /** Our own correlation data. Never PII. */
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface IssuedCard {
  /** The ISSUER's id for the card. */
  readonly providerCardRef: string;
  readonly status: CardStatus;
  readonly last4: string;
  readonly expMonth: number;
  readonly expYear: number;
  readonly network: string;
  readonly formFactor: CardFormFactor;
}

/**
 * A just-in-time authorisation, as the issuer presents it to us.
 *
 * This is a QUESTION, not a notification: the network is holding the line and
 * we have a strict deadline to answer. The adapter's only job is to translate
 * the issuer's payload into this shape — the decision is made above it.
 */
export interface CardAuthorizationRequest {
  readonly providerAuthRef: string;
  readonly providerCardRef: string;
  readonly amount: Money;
  readonly merchant: {
    readonly name: string;
    readonly mcc: string;
    readonly city?: string;
    readonly country?: string;
  };
  /** Network verification results, verbatim. Absent means "not supplied". */
  readonly verification?: {
    readonly cvc?: "pass" | "fail" | "unchecked";
    readonly expiry?: "pass" | "fail" | "unchecked";
    readonly postalCode?: "pass" | "fail" | "unchecked";
  };
}

/** An issuer-encrypted value. The key is not ours; the plaintext is not ours. */
export interface EncryptedValue {
  readonly iv: string;
  readonly data: string;
}

/** Card credentials, as ciphertext. */
export interface CardSecrets {
  readonly encryptedPan: EncryptedValue;
  readonly encryptedCvc: EncryptedValue;
}

export type CardAuthorizationDecision =
  | { readonly approve: true }
  | { readonly approve: false; readonly reason: string };

export interface CardIssuerProviderAdapter {
  readonly id: ProviderId;
  readonly kind: "issuing";

  /** Issue a card. Throws rather than returning a card that was not created. */
  issueCard(request: IssueCardRequest): Promise<IssuedCard>;

  /** Pull current state. Mandatory for the same reason `getStatus` is. */
  getCard(providerCardRef: string): Promise<IssuedCard>;

  /** Freeze / unfreeze / close. Returns the card as the issuer now reports it. */
  setCardStatus(providerCardRef: string, status: CardStatus): Promise<IssuedCard>;

  /**
   * Obtain the card credentials for display.
   *
   * Returns them ENCRYPTED. The plaintext PAN and CVC must never exist in our
   * process — that is the difference between being in PCI scope and not — so an
   * adapter returns the issuer's ciphertext and the client decrypts it with a
   * key our server never holds.
   *
   * An adapter that decrypted here, logged the result, or widened this return
   * type to a bare string has changed the compliance posture of the whole
   * platform, whatever else it did correctly.
   */
  getCardSecrets(providerCardRef: string): Promise<CardSecrets>;

  /**
   * Parse and cryptographically verify an inbound authorisation request.
   *
   * Throws `WebhookVerificationError` when the signature does not check out.
   * Returning an unverified authorisation would let anyone who can reach the
   * endpoint spend a customer's balance (AGENTS.md rule 3).
   */
  parseAuthorizationRequest(
    rawBody: string,
    headers: Readonly<Record<string, string>>
  ): Promise<CardAuthorizationRequest>;

  /** Render our decision in the shape this issuer expects on the wire. */
  encodeAuthorizationDecision(
    request: CardAuthorizationRequest,
    decision: CardAuthorizationDecision
  ): unknown;
}
