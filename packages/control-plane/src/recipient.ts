// ---------------------------------------------------------------------------
// Recipient verification — the last deterministic check before value leaves.
//
// FIVE WAYS MONEY REACHES THE WRONG PLACE WHILE EVERY OTHER CONTROL PASSES.
// The mandate is valid, the policy allows the amount, the agent is live, and:
//
//   1. WRONG CHAIN. The address is well-formed and belongs to the merchant on
//      Ethereum. The payment goes out on Arbitrum. On an EVM chain the same
//      20-byte address exists everywhere, so nothing about the string is wrong —
//      the funds simply land at a contract the merchant does not control, and on
//      an irreversible rail that is final.
//
//   2. ADDRESS SUBSTITUTION. The domain allowlist passed because the DOMAIN is
//      approved. The address came from the request body. An attacker who can
//      influence one field of an agent's payload does not need to defeat the
//      allowlist at all.
//
//   3. ADDRESS POISONING. An address visually identical in its first and last
//      four characters is pre-seeded into the agent's history, and a
//      "recently used" heuristic picks it up.
//
//   4. STALE INVOICE. A price quoted an hour ago is settled now, or the same
//      invoice is settled twice.
//
//   5. CART/PAYMENT MISMATCH. The human approved a $342 cart; the payment
//      carries $3,420. The cart hash is the only thing that binds them, and a
//      system that accepts an unbound amount has made the approval decorative.
//
// THE RULE THIS FILE ENFORCES: AN ADDRESS IS ONLY EVER TRUSTED BECAUSE IT WAS
// ATTESTED FOR THAT NETWORK, NEVER BECAUSE IT WAS WELL-FORMED OR BECAUSE IT
// ARRIVED ALONGSIDE AN APPROVED DOMAIN. `verifyRecipient` compares the presented
// destination against the recipient's attested set for the exact network, and
// refuses a match found on any other network.
//
// UNKNOWN IS A REFUSAL. An address family with no validator, a network not in
// the registry, a recipient with no record — each returns a denial rather than
// falling through. The alternative is a check that silently does nothing for
// precisely the assets nobody thought about.
// ---------------------------------------------------------------------------

import { mustParseAtomic, parseAtomic, type Atomic } from "./units";

export type AddressFamily = "evm" | "solana" | "tron" | "bank" | "upi";

export interface NetworkSpec {
  readonly networkId: string;
  readonly family: AddressFamily;
  /** EIP-155 chain id for EVM networks. Absent for non-EVM. */
  readonly chainId?: number;
  readonly displayName: string;
  /** False for testnets, so production can refuse them by inspection. */
  readonly mainnet: boolean;
}

/**
 * The networks the control plane can address.
 *
 * A network absent from here cannot be paid, which is the intent: adding a rail
 * is an explicit registry entry with an explicit address family, not a string
 * that happens to reach an adapter.
 */
export const NETWORKS: Readonly<Record<string, NetworkSpec>> = {
  ethereum: { networkId: "ethereum", family: "evm", chainId: 1, displayName: "Ethereum", mainnet: true },
  arbitrum_one: { networkId: "arbitrum_one", family: "evm", chainId: 42161, displayName: "Arbitrum One", mainnet: true },
  base: { networkId: "base", family: "evm", chainId: 8453, displayName: "Base", mainnet: true },
  polygon: { networkId: "polygon", family: "evm", chainId: 137, displayName: "Polygon", mainnet: true },
  optimism: { networkId: "optimism", family: "evm", chainId: 10, displayName: "OP Mainnet", mainnet: true },
  avalanche: { networkId: "avalanche", family: "evm", chainId: 43114, displayName: "Avalanche C-Chain", mainnet: true },
  base_sepolia: { networkId: "base_sepolia", family: "evm", chainId: 84532, displayName: "Base Sepolia", mainnet: false },
  // Arc — Circle's USDC-native L1. EVM address family, so the EVM validator
  // applies unchanged. NOTE the id convention: this registry uses underscores
  // (`arc_testnet`), while the x402 chain registry uses Arc's own hyphenated
  // `arc-testnet`. They are deliberately NOT aliases — see the rail row in
  // capability.ts. A name that fails to resolve fails closed, which is correct.
  arc: { networkId: "arc", family: "evm", chainId: 5042, displayName: "Arc", mainnet: true },
  arc_testnet: { networkId: "arc_testnet", family: "evm", chainId: 5042002, displayName: "Arc Testnet", mainnet: false },
  arbitrum_sepolia: { networkId: "arbitrum_sepolia", family: "evm", chainId: 421614, displayName: "Arbitrum Sepolia", mainnet: false },
  solana: { networkId: "solana", family: "solana", displayName: "Solana", mainnet: true },
  solana_devnet: { networkId: "solana_devnet", family: "solana", displayName: "Solana Devnet", mainnet: false },
  tron: { networkId: "tron", family: "tron", displayName: "Tron", mainnet: true },
  ach: { networkId: "ach", family: "bank", displayName: "ACH", mainnet: true },
  fednow: { networkId: "fednow", family: "bank", displayName: "FedNow", mainnet: true },
  sepa: { networkId: "sepa", family: "bank", displayName: "SEPA Instant", mainnet: true },
  upi: { networkId: "upi", family: "upi", displayName: "UPI", mainnet: true },
};

export function networkSpec(networkId: string): NetworkSpec | null {
  return NETWORKS[networkId] ?? null;
}

/** Validates an address for one family. Injected so this package stays
 *  dependency-free while Solana/Tron checks use a real decoder. */
export interface AddressValidator {
  readonly family: AddressFamily;
  /** True when the string is a structurally valid address for the family. */
  isValid(address: string): boolean;
  /** Canonical form for comparison — checksum-normalised, trimmed. */
  canonical(address: string): string;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * The EVM validator, implemented here because it needs no dependency.
 *
 * Comparison is lowercased rather than EIP-55 checksummed. That is deliberate:
 * two spellings of the same address differ only in case, and treating them as
 * different addresses would reject a legitimate destination attested in the
 * other spelling. The checksum's value is catching a typo at ENTRY, which is the
 * attestation path's job, not the comparison path's.
 */
export const evmAddressValidator: AddressValidator = {
  family: "evm",
  isValid: (address) => EVM_ADDRESS.test(address.trim()),
  canonical: (address) => address.trim().toLowerCase(),
};

/** What the payment claims about where the money goes. */
export interface RecipientAssertion {
  /** Merchant/resource domain, when the payment names one. */
  readonly domain?: string;
  readonly destination: string;
  readonly networkId: string;
  readonly asset: string;
}

export type AttestationMethod =
  /** Signed by a key the domain proved control of. */
  | "domain_signature"
  /** Published at a well-known path under the verified domain. */
  | "well_known"
  /** A human at the organization confirmed it through a step-up ceremony. */
  | "human_confirmed"
  /** A penny-drop or name-match against the destination account. */
  | "penny_drop"
  /** Returned by a provider we have a contract with. */
  | "provider_supplied";

/**
 * WHO is making the claim that this address belongs to this recipient.
 *
 * These are three different statements and they must never be collapsed into
 * one boolean. "FurlPay proved it", "a provider told us", and "the customer
 * typed it in and an admin clicked approve" carry entirely different liability
 * and entirely different failure modes — the third is only as good as the
 * enterprise's own change control, and a reader of the evidence six months
 * later needs to know which one they are looking at.
 *
 * Flattening them is the standard way an attested-recipient store becomes
 * theatre: everything ends up "attested" and the word stops meaning anything.
 */
export type AttestationTrustClass =
  /** FurlPay performed a check that could have failed: a signature over a
   *  challenge, a well-known document under a domain we resolved, a penny-drop
   *  whose amount only the account holder could read back. */
  | "furlpay_verified"
  /** An external provider asserted it. We are trusting the provider, and the
   *  provenance field says which one. We did not verify the address ourselves. */
  | "provider_asserted"
  /** A human at the paying organization vouched for it. No independent check
   *  happened; this is an allowlist entry with a name attached. */
  | "enterprise_allowlisted";

/**
 * The trust class each method actually earns.
 *
 * Deliberately a total function over the union so adding a method forces a
 * decision here rather than defaulting to the most trusted class — which is the
 * direction that silently upgrades a weaker attestation.
 */
export function trustClassFor(method: AttestationMethod): AttestationTrustClass {
  switch (method) {
    case "domain_signature":
    case "well_known":
    case "penny_drop":
      return "furlpay_verified";
    case "provider_supplied":
      return "provider_asserted";
    case "human_confirmed":
      return "enterprise_allowlisted";
  }
}

export interface AttestedDestination {
  readonly networkId: string;
  readonly asset: string;
  readonly address: string;
  readonly method: AttestationMethod;
  readonly attestedAt: string;
  /** When the attestation must be renewed. Absent = no expiry. */
  readonly expiresAt?: string;
  /**
   * WHO said so, in the method's own terms — the domain that signed, the
   * provider that returned it, the user id that confirmed it. Free text because
   * its shape differs per method, and recorded because "attested" without a
   * source is not a claim anybody can check afterwards.
   */
  readonly provenance?: string;
}

export interface RecipientRecord {
  readonly recipientId: string;
  readonly organizationId: string;
  readonly displayName: string;
  /** Verified domain, when one was proven. Never taken from a request. */
  readonly verifiedDomain?: string;
  readonly status: "ACTIVE" | "BLOCKED" | "PENDING";
  readonly destinations: readonly AttestedDestination[];
  readonly firstSeenAt: string;
  /** Merchant category code, when the recipient is a merchant. */
  readonly mcc?: string;
  /** ISO-3166 alpha-2 of the recipient's jurisdiction, when known. */
  readonly jurisdiction?: string;
}

/**
 * Binds an amount to what a human or merchant actually agreed to.
 *
 * `cartHash` is the field that makes an approval mean something. Without it,
 * "the user approved this cart" and "the payment carries this amount" are two
 * unrelated statements.
 */
export interface InvoiceBinding {
  readonly invoiceId: string;
  readonly cartHash: string;
  readonly amountAtomic: Atomic;
  readonly asset: string;
  readonly expiresAt: string;
  /** Set once the invoice has been settled, so a replay is visible. */
  readonly settledPaymentId?: string;
}

export type RecipientDenial =
  | "recipient_unknown"
  | "recipient_blocked"
  | "recipient_pending"
  | "network_unknown"
  | "network_not_mainnet"
  | "address_malformed"
  | "no_validator_for_family"
  | "destination_not_attested"
  | "destination_attested_on_other_network"
  | "attestation_expired"
  | "asset_not_attested"
  | "domain_mismatch"
  | "invoice_expired"
  | "invoice_already_settled"
  | "invoice_amount_mismatch"
  | "invoice_asset_mismatch"
  | "cart_hash_missing";

export interface RecipientVerdict {
  readonly ok: boolean;
  readonly reason?: RecipientDenial;
  readonly detail?: string;
  /** Set when the check passed. The canonical address the rail must be given. */
  readonly canonicalDestination?: string;
  readonly attestation?: AttestedDestination;
  /**
   * The trust class of the attestation that allowed this, when one did.
   *
   * Carried on the verdict rather than re-derived downstream so that the
   * evidence record and the policy engine cannot end up disagreeing about how
   * strong the destination check actually was.
   */
  readonly trustClass?: AttestationTrustClass;
  /** True when this recipient has no prior settled payment from this org. */
  readonly firstUse: boolean;
}

export interface VerifyRecipientInput {
  readonly assertion: RecipientAssertion;
  readonly record: RecipientRecord | null;
  readonly invoice?: InvoiceBinding;
  /** The amount the payment will actually move. Compared to the invoice. */
  readonly amountAtomic: Atomic;
  readonly validators: readonly AddressValidator[];
  readonly nowMs: number;
  /** True in production: testnets are refused by inspection. */
  readonly requireMainnet: boolean;
  /** True when this org has settled to this recipient before. */
  readonly seenBefore: boolean;
}

/**
 * Verify the destination. Deny-by-default at every step.
 *
 * ORDER: recipient existence and status, then network, then address form, then
 * ATTESTATION, then invoice binding. Attestation is the load-bearing step and
 * everything before it exists so that step can be reached with well-defined
 * inputs. The invoice check comes last because an amount mismatch against a
 * correctly attested recipient is a different incident from an unattested
 * address, and an operator reading the denial needs the more serious one named.
 */
export function verifyRecipient(input: VerifyRecipientInput): RecipientVerdict {
  const { assertion, record, nowMs } = input;
  const firstUse = !input.seenBefore;
  const deny = (reason: RecipientDenial, detail: string): RecipientVerdict => ({
    ok: false,
    reason,
    detail,
    firstUse,
  });

  if (!record) {
    return deny(
      "recipient_unknown",
      "no recipient record: an address supplied in a request is attacker-controlled from our side of the boundary and is never trusted on its own"
    );
  }
  if (record.status === "BLOCKED") {
    return deny("recipient_blocked", `recipient ${record.recipientId} is blocked`);
  }
  if (record.status === "PENDING") {
    return deny("recipient_pending", `recipient ${record.recipientId} has not completed verification`);
  }

  const network = networkSpec(assertion.networkId);
  if (!network) {
    return deny(
      "network_unknown",
      `network "${assertion.networkId}" is not in the registry; an unregistered network has no address family and therefore no validation`
    );
  }
  if (input.requireMainnet && !network.mainnet) {
    return deny("network_not_mainnet", `${network.displayName} is a testnet and this environment requires mainnet`);
  }

  const validator = input.validators.find((v) => v.family === network.family);
  if (!validator) {
    return deny(
      "no_validator_for_family",
      `no address validator registered for family "${network.family}"; refusing rather than accepting an unchecked destination`
    );
  }
  if (!validator.isValid(assertion.destination)) {
    return deny("address_malformed", `destination is not a valid ${network.family} address`);
  }

  const presented = validator.canonical(assertion.destination);

  // Attestation, on the EXACT network. A match elsewhere is reported as its own
  // reason because that is the wrong-chain incident (header, case 1), and an
  // operator needs it distinguished from an address we have never seen.
  const onNetwork = record.destinations.filter((d) => d.networkId === assertion.networkId);
  const elsewhere = record.destinations.filter(
    (d) => d.networkId !== assertion.networkId && validator.canonical(d.address) === presented
  );

  const match = onNetwork.find((d) => validator.canonical(d.address) === presented);
  if (!match) {
    if (elsewhere.length > 0) {
      return deny(
        "destination_attested_on_other_network",
        `this address is attested for ${elsewhere.map((d) => d.networkId).join(", ")} but not for ${assertion.networkId}; ` +
          `paying it on the wrong chain sends funds to an address the recipient may not control there`
      );
    }
    return deny(
      "destination_not_attested",
      `no attested destination for ${record.recipientId} on ${assertion.networkId} matches the presented address`
    );
  }

  if (match.expiresAt) {
    const expires = Date.parse(match.expiresAt);
    if (Number.isFinite(expires) && nowMs >= expires) {
      return deny("attestation_expired", `the attestation for this destination expired at ${match.expiresAt}`);
    }
  }
  if (match.asset.toUpperCase() !== assertion.asset.toUpperCase()) {
    return deny(
      "asset_not_attested",
      `destination is attested for ${match.asset}, not ${assertion.asset}`
    );
  }

  // Domain, when the payment names one. Compared against the VERIFIED domain on
  // the record, never against the one in the request.
  if (assertion.domain) {
    const claimed = assertion.domain.trim().toLowerCase();
    const verified = record.verifiedDomain?.trim().toLowerCase();
    if (!verified || (claimed !== verified && !claimed.endsWith(`.${verified}`))) {
      return deny(
        "domain_mismatch",
        `payment names domain "${claimed}" but this recipient's verified domain is ${verified ? `"${verified}"` : "unset"}`
      );
    }
  }

  // Invoice binding.
  if (input.invoice) {
    const inv = input.invoice;
    if (!inv.cartHash) {
      return deny("cart_hash_missing", "invoice carries no cart hash, so the approved cart cannot be bound to this amount");
    }
    if (inv.settledPaymentId) {
      return deny(
        "invoice_already_settled",
        `invoice ${inv.invoiceId} was already settled by payment ${inv.settledPaymentId}`
      );
    }
    const expires = Date.parse(inv.expiresAt);
    if (!Number.isFinite(expires) || nowMs >= expires) {
      return deny("invoice_expired", `invoice ${inv.invoiceId} expired at ${inv.expiresAt}`);
    }
    if (inv.asset.toUpperCase() !== assertion.asset.toUpperCase()) {
      return deny("invoice_asset_mismatch", `invoice is denominated in ${inv.asset}, payment in ${assertion.asset}`);
    }
    const invoiceAmount = parseAtomic(inv.amountAtomic);
    const paymentAmount = parseAtomic(input.amountAtomic);
    if (invoiceAmount === null || paymentAmount === null) {
      return deny("invoice_amount_mismatch", "invoice or payment amount is not an integer amount");
    }
    // EXACT equality. A tolerance here is a tolerance on how much more than the
    // approved amount may be taken, and there is no correct non-zero value.
    if (invoiceAmount !== paymentAmount) {
      return deny(
        "invoice_amount_mismatch",
        `invoice is for ${inv.amountAtomic} and the payment carries ${input.amountAtomic}`
      );
    }
  }

  return {
    ok: true,
    canonicalDestination: presented,
    attestation: match,
    trustClass: trustClassFor(match.method),
    firstUse,
  };
}

/**
 * Whether two addresses share a prefix/suffix while differing in the middle —
 * the address-poisoning shape (header, case 3).
 *
 * Reported as a SIGNAL, not a denial: a genuine collision on 4+4 characters is
 * rare but possible, and refusing on it alone would block a legitimate payment
 * with no way to proceed. The control plane routes it to human approval.
 */
export function looksLikePoisoning(a: string, b: string, edgeChars = 4): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x === y) return false;
  if (x.length !== y.length || x.length < edgeChars * 2) return false;
  return (
    x.slice(0, edgeChars) === y.slice(0, edgeChars) && x.slice(-edgeChars) === y.slice(-edgeChars)
  );
}

/** Total of a cart's line items, atomic — for binding a cart hash to a total. */
export function cartTotalAtomic(items: readonly { amountAtomic: Atomic }[]): Atomic {
  let total = 0n;
  for (const i of items) total += mustParseAtomic(i.amountAtomic, "cart item amount");
  return total.toString();
}
