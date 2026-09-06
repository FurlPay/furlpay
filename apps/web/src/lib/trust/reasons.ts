// ---------------------------------------------------------------------------
// Reason codes — the vocabulary of every risk decision FurlPay makes.
//
// WHY A REGISTRY AND NOT STRINGS. The existing risk engine returns
// `signals: string[]` containing prose like "VPN/proxy in use". That reads
// fine and is unusable for everything else a fraud system has to do:
//
//   - An analyst cannot filter a queue by a sentence.
//   - A model cannot use a sentence as a feature.
//   - A regulator asking "on what basis was this customer declined" gets a
//     string that was edited three times since the decision was made.
//   - A customer-facing message cannot be derived from it safely, because the
//     internal wording leaks the detection method.
//
// So a reason is a CODE with a stable identity, a severity, a category, an
// internal explanation and a separately-authored customer-safe message. The
// code never changes once issued; the wording may.
//
// THE DISCLOSURE RULE, which is the subtle one. Telling a fraudster exactly
// which control fired is telling them what to change. `customerMessage` is
// deliberately vaguer than `analystExplanation`, and some codes have no
// customer message at all — those decisions surface as a generic outcome.
// This is not obscurity for its own sake: a card-testing ring that learns
// "declined because 6 cards in 10 minutes" simply uses 5.
//
// EVERY CODE MUST BE ACTIONABLE. If a code cannot change a decision, it is
// telemetry, not a reason, and it belongs in the event stream instead.
// ---------------------------------------------------------------------------

export type ReasonCategory =
  | "identity"
  | "device"
  | "network"
  | "behavior"
  | "graph"
  | "payment"
  | "velocity"
  | "compliance"
  | "account";

/**
 * How much a reason moves the needle, before weighting.
 *
 * `informational` exists so a positive or neutral observation can be recorded
 * in the same structure — an assessment that only ever lists bad news gives an
 * analyst no way to see what the system got right.
 */
export type ReasonSeverity = "informational" | "low" | "medium" | "high" | "critical";

/** Which way the reason pushes. Trust-building signals are first-class. */
export type ReasonDirection = "raises_risk" | "lowers_risk";

export interface ReasonDefinition {
  readonly code: string;
  readonly category: ReasonCategory;
  readonly severity: ReasonSeverity;
  readonly direction: ReasonDirection;
  /** What an analyst sees. May name the detection method. */
  readonly analystExplanation: string;
  /**
   * What a customer may be told, or null when nothing may be disclosed.
   *
   * Null is the default for anything that reveals a detection threshold. The
   * decision still surfaces — as a generic "we need to verify some details" —
   * but the reason does not.
   */
  readonly customerMessage: string | null;
  /**
   * Whether this reason alone may drive a decline.
   *
   * Almost nothing should be. A single-signal decline is a single point of
   * failure for a false positive, and the signals that seem most damning
   * (a shared device, a VPN) have entirely ordinary explanations — a family
   * tablet, a corporate network. Sanctions is the exception, because there the
   * legal obligation is absolute and does not weigh convenience.
   */
  readonly sufficientAlone: boolean;
}

/**
 * The registry.
 *
 * Grouped by category. Codes are `CAT.SPECIFIC` and are permanent: an analyst
 * queue, a model feature and a regulator's audit all key on them.
 */
export const REASONS = {
  // ── Identity ─────────────────────────────────────────────────────────
  "IDN.DOCUMENT_UNVERIFIED": {
    code: "IDN.DOCUMENT_UNVERIFIED",
    category: "identity",
    severity: "medium",
    direction: "raises_risk",
    analystExplanation: "No government ID has been verified for this identity.",
    customerMessage: "We need to verify your identity document before continuing.",
    sufficientAlone: false,
  },
  "IDN.NAME_DOB_MISMATCH": {
    code: "IDN.NAME_DOB_MISMATCH",
    category: "identity",
    severity: "high",
    direction: "raises_risk",
    analystExplanation:
      "Name or date of birth disagrees across two authoritative sources (document vs bank vs declared).",
    customerMessage: "Some of the details you provided do not match our records.",
    sufficientAlone: false,
  },
  "IDN.SYNTHETIC_PATTERN": {
    code: "IDN.SYNTHETIC_PATTERN",
    category: "identity",
    severity: "critical",
    direction: "raises_risk",
    analystExplanation:
      "Identity shows synthetic-construction markers: real-looking components with no corroborating " +
      "history, or components that individually verify but have never co-occurred.",
    // Never disclosed. A synthetic-identity operator who learns which component
    // failed simply rebuilds that component.
    customerMessage: null,
    sufficientAlone: false,
  },
  "IDN.THIN_HISTORY": {
    code: "IDN.THIN_HISTORY",
    category: "identity",
    severity: "low",
    direction: "raises_risk",
    analystExplanation:
      "Identity has little verifiable history. Weak on its own — every genuine new customer looks " +
      "like this, and young or recently-migrated customers look like it permanently.",
    customerMessage: null,
    sufficientAlone: false,
  },
  "IDN.DOCUMENT_VERIFIED": {
    code: "IDN.DOCUMENT_VERIFIED",
    category: "identity",
    severity: "medium",
    direction: "lowers_risk",
    analystExplanation: "Government ID verified with a liveness-bound selfie match.",
    customerMessage: null,
    sufficientAlone: false,
  },

  // ── Device ───────────────────────────────────────────────────────────
  "DEV.EMULATOR": {
    code: "DEV.EMULATOR",
    category: "device",
    severity: "high",
    direction: "raises_risk",
    analystExplanation: "Runtime environment presents as an emulator or virtual machine.",
    customerMessage: null,
    sufficientAlone: false,
  },
  "DEV.INTEGRITY_FAILED": {
    code: "DEV.INTEGRITY_FAILED",
    category: "device",
    severity: "high",
    direction: "raises_risk",
    analystExplanation:
      "App or OS integrity check failed: rooted/jailbroken, hooked, repackaged, or debugger attached.",
    customerMessage: null,
    sufficientAlone: false,
  },
  "DEV.MUTATION_MID_SESSION": {
    code: "DEV.MUTATION_MID_SESSION",
    category: "device",
    severity: "high",
    direction: "raises_risk",
    analystExplanation:
      "Device attributes changed within one session. A device is not permanently trustworthy; the " +
      "environment that started the session is not necessarily the one completing the payment.",
    customerMessage: null,
    sufficientAlone: false,
  },
  "DEV.NEW_TO_ACCOUNT": {
    code: "DEV.NEW_TO_ACCOUNT",
    category: "device",
    severity: "low",
    direction: "raises_risk",
    analystExplanation: "First time this device has been seen on this account.",
    customerMessage: "We do not recognise this device.",
    sufficientAlone: false,
  },
  "DEV.LONG_TENURE": {
    code: "DEV.LONG_TENURE",
    category: "device",
    severity: "medium",
    direction: "lowers_risk",
    analystExplanation:
      "Device has a long clean history on this account. The strongest single trust signal available, " +
      "and the reason step-up should not fire on a familiar device for an ordinary amount.",
    customerMessage: null,
    sufficientAlone: false,
  },

  // ── Network ──────────────────────────────────────────────────────────
  "NET.ANONYMISING_PROXY": {
    code: "NET.ANONYMISING_PROXY",
    category: "network",
    severity: "medium",
    direction: "raises_risk",
    analystExplanation:
      "Connection originates from a VPN, hosting provider, or anonymising relay. WEAK on its own: " +
      "privacy-conscious and travelling customers use VPNs routinely, and treating it as strong " +
      "evidence produces false positives concentrated on exactly those customers.",
    customerMessage: null,
    sufficientAlone: false,
  },
  "NET.RESIDENTIAL_PROXY_SUSPECTED": {
    code: "NET.RESIDENTIAL_PROXY_SUSPECTED",
    category: "network",
    severity: "high",
    direction: "raises_risk",
    analystExplanation:
      "Traffic patterns suggest a residential proxy: consumer ASN paired with datacentre-like timing, " +
      "or an address rotating across unrelated accounts. Materially stronger than a plain VPN because " +
      "the entire purpose of a residential proxy is to defeat IP reputation.",
    customerMessage: null,
    sufficientAlone: false,
  },
  "NET.IMPOSSIBLE_TRAVEL": {
    code: "NET.IMPOSSIBLE_TRAVEL",
    category: "network",
    severity: "high",
    direction: "raises_risk",
    analystExplanation:
      "Two sessions separated by a distance not coverable in the elapsed time. Confounded by VPN exit " +
      "changes, so it must be weighed with the proxy signals rather than alone.",
    customerMessage: null,
    sufficientAlone: false,
  },

  // ── Behaviour ────────────────────────────────────────────────────────
  "BEH.AUTOMATION": {
    code: "BEH.AUTOMATION",
    category: "behavior",
    severity: "high",
    direction: "raises_risk",
    analystExplanation:
      "Interaction is machine-generated: no pointer entropy, uniform inter-key timing, or field " +
      "completion faster than human motor limits.",
    customerMessage: null,
    sufficientAlone: false,
  },
  "BEH.PASTED_CREDENTIALS": {
    code: "BEH.PASTED_CREDENTIALS",
    category: "behavior",
    severity: "low",
    direction: "raises_risk",
    analystExplanation:
      "Identity or payment fields were pasted rather than typed. Very weak alone — password managers " +
      "paste, and punishing it pushes customers toward worse security habits.",
    customerMessage: null,
    sufficientAlone: false,
  },
  "BEH.DEVIATES_FROM_BASELINE": {
    code: "BEH.DEVIATES_FROM_BASELINE",
    category: "behavior",
    severity: "medium",
    direction: "raises_risk",
    analystExplanation:
      "Session behaviour differs materially from this account's own established baseline. Requires an " +
      "established baseline; on a new account there is nothing to deviate from and this must not fire.",
    customerMessage: null,
    sufficientAlone: false,
  },

  // ── Graph ────────────────────────────────────────────────────────────
  "GRF.SHARED_DEVICE_CLUSTER": {
    code: "GRF.SHARED_DEVICE_CLUSTER",
    category: "graph",
    severity: "high",
    direction: "raises_risk",
    analystExplanation:
      "Device is shared across accounts beyond a plausible household. Legitimate causes exist " +
      "(family, shared computer, refurbished handset), so the threshold matters more than the signal.",
    customerMessage: null,
    sufficientAlone: false,
  },
  "GRF.LINKED_TO_CONFIRMED_FRAUD": {
    code: "GRF.LINKED_TO_CONFIRMED_FRAUD",
    category: "graph",
    severity: "critical",
    direction: "raises_risk",
    analystExplanation:
      "Within a short path of an entity involved in CONFIRMED fraud — not merely a declined or " +
      "reviewed one. Distance matters: a direct shared device is not the same as a friend-of-a-friend.",
    customerMessage: null,
    sufficientAlone: false,
  },
  "GRF.SHARED_INSTRUMENT": {
    code: "GRF.SHARED_INSTRUMENT",
    category: "graph",
    severity: "high",
    direction: "raises_risk",
    analystExplanation:
      "One payment instrument or bank account is attached to multiple unrelated identities — the " +
      "classic mule and card-farming shape.",
    customerMessage: null,
    sufficientAlone: false,
  },
  "GRF.DENSE_COMPONENT": {
    code: "GRF.DENSE_COMPONENT",
    category: "graph",
    severity: "high",
    direction: "raises_risk",
    analystExplanation:
      "Entity sits in an abnormally dense component: many accounts sharing few devices, instruments " +
      "and addresses. The structural signature of a fraud ring rather than of any one bad account.",
    customerMessage: null,
    sufficientAlone: false,
  },

  // ── Payment ──────────────────────────────────────────────────────────
  "PAY.CARD_TESTING": {
    code: "PAY.CARD_TESTING",
    category: "payment",
    severity: "critical",
    direction: "raises_risk",
    analystExplanation:
      "Rapid sequence of small authorisations across many instruments — validating stolen card data.",
    customerMessage: null,
    sufficientAlone: false,
  },
  "PAY.INSTRUMENT_CHARGEBACK_HISTORY": {
    code: "PAY.INSTRUMENT_CHARGEBACK_HISTORY",
    category: "payment",
    severity: "high",
    direction: "raises_risk",
    analystExplanation: "This instrument has previously produced a fraud-coded chargeback.",
    customerMessage: null,
    sufficientAlone: false,
  },
  "PAY.NEW_BENEFICIARY_LARGE_AMOUNT": {
    code: "PAY.NEW_BENEFICIARY_LARGE_AMOUNT",
    category: "payment",
    severity: "high",
    direction: "raises_risk",
    analystExplanation:
      "Large transfer to a beneficiary added minutes ago. The dominant shape of both account takeover " +
      "and authorised-push-payment scams.",
    customerMessage: "For your security we are confirming this new recipient.",
    sufficientAlone: false,
  },

  // ── Velocity ─────────────────────────────────────────────────────────
  "VEL.BURST": {
    code: "VEL.BURST",
    category: "velocity",
    severity: "high",
    direction: "raises_risk",
    analystExplanation: "Money-movement attempts exceed the per-minute ceiling for this account tier.",
    customerMessage: null,
    sufficientAlone: false,
  },
  "VEL.RAPID_IN_OUT": {
    code: "VEL.RAPID_IN_OUT",
    category: "velocity",
    severity: "critical",
    direction: "raises_risk",
    analystExplanation:
      "Funds in and substantially out within a short window, with no holding behaviour. The defining " +
      "pattern of mule activity.",
    customerMessage: null,
    sufficientAlone: false,
  },
  "VEL.STRUCTURING": {
    code: "VEL.STRUCTURING",
    category: "velocity",
    severity: "high",
    direction: "raises_risk",
    analystExplanation: "Multiple transfers sized just under a reporting or verification threshold.",
    customerMessage: null,
    sufficientAlone: false,
  },

  // ── Compliance ───────────────────────────────────────────────────────
  "CMP.SANCTIONS_MATCH": {
    code: "CMP.SANCTIONS_MATCH",
    category: "compliance",
    severity: "critical",
    direction: "raises_risk",
    analystExplanation: "Counterparty or customer matches a sanctions designation.",
    customerMessage: "We are unable to process this transaction.",
    // The single code that stands alone. The obligation is absolute and does
    // not weigh convenience or the risk of a false positive.
    sufficientAlone: true,
  },
  "CMP.JURISDICTION_BLOCKED": {
    code: "CMP.JURISDICTION_BLOCKED",
    category: "compliance",
    severity: "critical",
    direction: "raises_risk",
    analystExplanation: "Customer or counterparty is in a jurisdiction FurlPay does not serve.",
    customerMessage: "We do not currently operate in your region.",
    sufficientAlone: true,
  },
  "CMP.KYC_TIER_EXCEEDED": {
    code: "CMP.KYC_TIER_EXCEEDED",
    category: "compliance",
    severity: "medium",
    direction: "raises_risk",
    analystExplanation: "Amount exceeds the cap for the customer's current verification tier.",
    customerMessage: "This amount requires additional verification.",
    sufficientAlone: false,
  },

  // ── Account ──────────────────────────────────────────────────────────
  "ACC.CREDENTIAL_CHANGE_RECENT": {
    code: "ACC.CREDENTIAL_CHANGE_RECENT",
    category: "account",
    severity: "high",
    direction: "raises_risk",
    analystExplanation:
      "Email, phone or authentication method changed recently. Combined with a withdrawal this is the " +
      "canonical takeover sequence.",
    customerMessage: null,
    sufficientAlone: false,
  },
  "ACC.DORMANT_REACTIVATION": {
    code: "ACC.DORMANT_REACTIVATION",
    category: "account",
    severity: "medium",
    direction: "raises_risk",
    analystExplanation: "Long-dormant account resumed activity with an immediate money movement.",
    customerMessage: null,
    sufficientAlone: false,
  },
  "ACC.ESTABLISHED_GOOD_HISTORY": {
    code: "ACC.ESTABLISHED_GOOD_HISTORY",
    category: "account",
    severity: "high",
    direction: "lowers_risk",
    analystExplanation:
      "Long tenure, settled volume, zero disputes. The counterweight that keeps good customers out of " +
      "step-up; without it a risk engine only ever ratchets upward.",
    customerMessage: null,
    sufficientAlone: false,
  },
} as const satisfies Record<string, ReasonDefinition>;

export type ReasonCode = keyof typeof REASONS;

export function reasonDefinition(code: ReasonCode): ReasonDefinition {
  return REASONS[code];
}

/** An observed reason: the definition, plus why it fired here. */
export interface ObservedReason {
  readonly code: ReasonCode;
  /**
   * Analyst-facing specifics — the counts and identifiers behind the code.
   * Must never contain a raw PAN, a full document number, or a credential.
   */
  readonly detail?: string;
  /**
   * How sure we are the condition holds, 0..1.
   *
   * Separate from severity: "device is definitely shared across 14 accounts"
   * and "behaviour is probably automated" can carry the same severity while
   * deserving very different weight.
   */
  readonly confidence: number;
  /** When the underlying evidence was observed. Drives decay. */
  readonly observedAt: string;
}

/** Codes that may drive a decline on their own. */
export function standaloneCodes(): readonly ReasonCode[] {
  return (Object.keys(REASONS) as ReasonCode[]).filter((c) => REASONS[c].sufficientAlone);
}

/**
 * The customer-safe rendering of a decision.
 *
 * Returns only messages that are cleared for disclosure, and falls back to a
 * single generic line when none are. Deliberately does NOT concatenate every
 * available message: three specific reasons together re-disclose the detection
 * logic that each one alone was written to protect.
 */
export function customerFacingMessage(reasons: readonly ObservedReason[]): string {
  const disclosable = reasons.filter((r) => REASONS[r.code].customerMessage !== null);

  if (disclosable.length === 0) {
    return "We need to check a few details before we can continue.";
  }
  // Highest-severity disclosable message wins, so the customer gets the most
  // actionable instruction rather than the first one that happened to fire.
  const order: Record<ReasonSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    informational: 4,
  };
  const ranked = reasons
    .filter((r) => REASONS[r.code].customerMessage !== null)
    .sort((a, b) => order[REASONS[a.code].severity] - order[REASONS[b.code].severity]);
  return REASONS[ranked[0].code].customerMessage!;
}
