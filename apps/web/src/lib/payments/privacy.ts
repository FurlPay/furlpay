// ---------------------------------------------------------------------------
// Payment privacy modes — the vocabulary, and what each one actually provides.
//
// ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
//
// "Private payment" is six different properties that are routinely collapsed
// into one word, and the collapse is how a system ends up advertising privacy
// it does not have. This module separates them, states which FurlPay provides
// today (one, partially), and makes the unavailable modes UNREPRESENTABLE at
// runtime rather than silently degrading to a direct transfer.
//
// The specific failure it guards: someone adds `privacy: { mode:
// "private_pool" }` to a request, the router does not recognise it, the
// payment settles as an ordinary public transfer, and the caller believes the
// sender was hidden. That is worse than having no privacy feature at all —
// the user made a disclosure decision on a false premise.
//
// ── THE SIX PROPERTIES ─────────────────────────────────────────────────────
//
//   1. wallet isolation       a different address signs, so the payer is not
//                             the main account. Address still public.
//   2. address privacy        the payer address is not reusable/linkable
//                             across payments.
//   3. transaction privacy    the transfer itself is not publicly readable.
//   4. amount privacy         the value moved is hidden.
//   5. unlinkability          deposit and withdrawal cannot be correlated.
//   6. identity privacy       the real-world party is not identifiable.
//
// Wallet isolation is the weakest and the easiest to mistake for the rest.
// ---------------------------------------------------------------------------

export type PaymentPrivacyMode =
  /** What every FurlPay payment does today. Fully public on-chain. */
  | "direct"
  /** A dedicated signing address per account/agent. Isolation, not privacy. */
  | "isolated_wallet"
  /** A fresh receive address per payment/customer. */
  | "deposit_address"
  /** A shielded pool: public -> private -> public. */
  | "private_pool";

export const PAYMENT_PRIVACY_MODES: readonly PaymentPrivacyMode[] = [
  "direct",
  "isolated_wallet",
  "deposit_address",
  "private_pool",
] as const;

/** Which of the six properties a mode actually delivers. */
export interface PrivacyProperties {
  walletIsolation: boolean;
  addressPrivacy: boolean;
  transactionPrivacy: boolean;
  amountPrivacy: boolean;
  unlinkability: boolean;
  identityPrivacy: boolean;
}

export interface PrivacyModeSpec {
  mode: PaymentPrivacyMode;
  /** False when the repository cannot deliver this mode today. */
  available: boolean;
  properties: PrivacyProperties;
  /** What an on-chain observer can still see. Written for a reader, not a spec. */
  observable: string;
  /** What must exist before `available` can become true. Empty when it is. */
  blockedBy: readonly string[];
}

const NONE: PrivacyProperties = {
  walletIsolation: false,
  addressPrivacy: false,
  transactionPrivacy: false,
  amountPrivacy: false,
  unlinkability: false,
  identityPrivacy: false,
};

export const PRIVACY_MODES: Record<PaymentPrivacyMode, PrivacyModeSpec> = {
  // ── The only mode that exists today ──────────────────────────────────────
  direct: {
    mode: "direct",
    available: true,
    properties: { ...NONE },
    observable:
      "Everything. The payer address, the recipient, the token, the amount, and " +
      "the payer's entire history and balance on that chain. Note that in x402 " +
      "settlement the transaction is SUBMITTED by the facilitator (which pays " +
      "gas) but the ERC-20 Transfer event carries payer -> recipient, because " +
      "the payer signed an EIP-3009 authorization naming themselves. The " +
      "facilitator is a gas payer, not a sender, and provides no privacy.",
    blockedBy: [],
  },

  // ── Not available: no per-account signing address exists ─────────────────
  isolated_wallet: {
    mode: "isolated_wallet",
    available: false,
    // Would provide isolation only. The address is still fully public, and a
    // funding transaction from the main account relinks it immediately.
    properties: { ...NONE, walletIsolation: true },
    observable:
      "The isolated address, the recipient, the token and the amount. If that " +
      "address was ever funded from a known account, the link is public and " +
      "permanent, so this is isolation rather than privacy.",
    blockedBy: [
      "No per-account signing address exists. Agent credentials are API keys " +
        "(sk_/pk_/rk_ with scopes), not on-chain wallets — see lib/apiKeys.ts.",
      "lib/kms.ts exposes three fixed logical keys (gas-sponsor, settlement, " +
        "attestation) and no key-derivation capability.",
      "TREASURY_WALLETS in lib/treasury/register.ts is empty: no wallet is " +
        "provisioned under a documented control policy in any environment.",
    ],
  },

  // ── Not available: no address derivation or sweeping ─────────────────────
  deposit_address: {
    mode: "deposit_address",
    available: false,
    properties: { ...NONE, walletIsolation: true, addressPrivacy: true },
    observable:
      "The deposit address, the recipient, the token and the amount. Sweeping " +
      "to a collection wallet is itself a public transaction, so addresses " +
      "become linkable at sweep time unless the sweep is separately protected.",
    blockedBy: [
      "No HD/address derivation anywhere in the repository (no xpub, no " +
        "derivePath, no HDNode).",
      "Deposits are attributed by WATCHING a user's linked wallet via provider " +
        "webhooks (lib/services/deposits.ts), not by issuing addresses.",
      "No sweeping, no per-address custody, and no key material for a derived " +
        "address — which would require custody FurlPay does not currently hold.",
    ],
  },

  // ── Not available: requires custody FurlPay deliberately does not take ───
  private_pool: {
    mode: "private_pool",
    available: false,
    // A shielded pool is the only option here that delivers real transaction
    // and amount privacy. It is also the only one that requires custody.
    properties: {
      walletIsolation: true,
      addressPrivacy: true,
      transactionPrivacy: true,
      amountPrivacy: true,
      unlinkability: true,
      // Never. FurlPay still knows who its customer is, and must.
      identityPrivacy: false,
    },
    observable:
      "A deposit into the pool and a withdrawal out of it, both public. What is " +
      "hidden is the LINK between them, and the amount. Timing and value " +
      "correlation remain real attack surfaces for a low-traffic pool.",
    blockedBy: [
      "Requires FurlPay to take custody: funds must be deposited into the pool " +
        "before they can be paid out. The custody model is " +
        "SELF_CUSTODIAL_ONCHAIN (lib/custody.ts) — the user's device key " +
        "controls the funds and the chain is the source of truth.",
      "No treasury wallet is provisioned to hold pooled funds.",
      "Requires a provider integration (contracts, SDK, relayer, proving) that " +
        "has not been evaluated against this codebase.",
      "Compliance: screening must happen BEFORE funds enter the pool, because " +
        "a blocked payout after entry strands customer money.",
    ],
  },
};

export class UnavailablePrivacyMode extends Error {
  constructor(
    readonly mode: PaymentPrivacyMode,
    readonly blockedBy: readonly string[],
  ) {
    super(
      `Payment privacy mode "${mode}" is not available. ` +
        `It is declared so the architecture is explicit, not because it works. ` +
        `Blocked by: ${blockedBy.join(" ")}`,
    );
    this.name = "UnavailablePrivacyMode";
  }
}

/**
 * Resolve a requested mode, or refuse.
 *
 * FAILS CLOSED, and that is the entire point. An unavailable mode throws
 * rather than falling back to `direct`, because a silent fallback would settle
 * a payment publicly while the caller believed it was shielded. Refusing is
 * recoverable; a mistaken disclosure is not.
 */
export function resolvePrivacyMode(requested?: string | null): PrivacyModeSpec {
  if (requested == null || requested === "") return PRIVACY_MODES.direct;
  const spec = PRIVACY_MODES[requested as PaymentPrivacyMode];
  if (!spec) {
    throw new UnavailablePrivacyMode(requested as PaymentPrivacyMode, [
      `Unknown mode. Valid modes: ${PAYMENT_PRIVACY_MODES.join(", ")}.`,
    ]);
  }
  if (!spec.available) throw new UnavailablePrivacyMode(spec.mode, spec.blockedBy);
  return spec;
}

/** Modes that can actually be used right now. */
export function availablePrivacyModes(): PaymentPrivacyMode[] {
  return PAYMENT_PRIVACY_MODES.filter((m) => PRIVACY_MODES[m].available);
}

/**
 * Whether a mode hides anything from a chain observer.
 *
 * Deliberately NOT "is this private" — wallet isolation and address privacy
 * change which address is visible, they do not hide the transaction. Only a
 * mode with transactionPrivacy conceals the transfer itself.
 */
export function hidesTransaction(mode: PaymentPrivacyMode): boolean {
  return PRIVACY_MODES[mode].properties.transactionPrivacy;
}

/**
 * What FurlPay retains internally regardless of on-chain privacy.
 *
 * A chain privacy layer hides data from the PUBLIC. It does not and must not
 * remove FurlPay's own records: the customer, the source of funds, the
 * destination, the screening result and the audit trail all survive every
 * mode. Privacy here means "not public", never "not recorded".
 */
export const ALWAYS_RETAINED_INTERNALLY = [
  "customer identity (KYC)",
  "source of funds",
  "destination address",
  "payment purpose",
  "sanctions/screening result",
  "authorization decision and approver",
  "ledger postings",
  "audit events",
] as const;
