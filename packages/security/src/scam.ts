// ---------------------------------------------------------------------------
// Transaction-simulation + ML scam detection (Phantom/Blowfish seam). Where
// risk.ts scores the *device/behavior*, this scores the *transaction itself*
// BEFORE it is signed: it simulates the effect (what leaves the wallet, what
// approval is granted, who receives it) and runs a logistic-regression scam
// classifier over engineered features. The outcome gates signing alongside the
// device risk gate.
//
// MOCK: the model weights are fixed (a small, hand-fit logistic model) and the
// simulation is analytic rather than an on-chain `eth_call`. A live build swaps
// `simulateTransaction` for a real fork simulation and loads trained weights.
// ---------------------------------------------------------------------------

export interface TxRequest {
  from: string;
  to: string;
  /** USD value leaving the wallet (0 for pure approvals). */
  valueUsd: number;
  /** ERC-20 approval amount in tokens; Infinity/2^256-1 => unlimited. */
  approvalAmount?: number;
  token?: string;
  /** Age of the recipient address in days (0 = brand new). */
  recipientAgeDays?: number;
  /** True if `to` resembles a recently-seen address (address poisoning). */
  lookalikeOfKnown?: boolean;
  /** Recipient appears on a scam/sanctions list. */
  flaggedRecipient?: boolean;
  /** The wallet has never transacted with `to` before. */
  firstInteraction?: boolean;
  /** Destination is a verified/known-good contract (DEX, bridge). */
  knownGoodContract?: boolean;
}

export interface SimulatedEffect {
  balanceChangesUsd: number; // negative = leaves the wallet
  approvals: { token: string; unlimited: boolean; amount: number }[];
  recipient: string;
  warnings: string[];
}

/** Analytic pre-sign simulation: what this transaction would do. */
export function simulateTransaction(tx: TxRequest): SimulatedEffect {
  const warnings: string[] = [];
  const approvals: SimulatedEffect["approvals"] = [];

  if (tx.approvalAmount !== undefined) {
    const unlimited = !Number.isFinite(tx.approvalAmount) || tx.approvalAmount >= 1e30;
    approvals.push({ token: tx.token ?? "token", unlimited, amount: unlimited ? Infinity : tx.approvalAmount });
    if (unlimited && !tx.knownGoodContract) {
      warnings.push("Grants UNLIMITED token approval to an unverified contract");
    }
  }
  if (tx.flaggedRecipient) warnings.push("Recipient is on a scam/sanctions list");
  if (tx.lookalikeOfKnown) warnings.push("Recipient looks like a known address (possible address poisoning)");
  if (tx.firstInteraction && tx.valueUsd > 1000) warnings.push("Large transfer to a never-before-seen address");
  if ((tx.recipientAgeDays ?? 999) < 1 && tx.valueUsd > 0) warnings.push("Recipient wallet was created moments ago");

  return {
    balanceChangesUsd: -Math.abs(tx.valueUsd),
    approvals,
    recipient: tx.to,
    warnings,
  };
}

// --- logistic scam classifier ----------------------------------------------

// Engineered features → weights (hand-fit; a live build loads trained values).
const WEIGHTS = {
  bias: -3.2,
  flaggedRecipient: 5.5,
  lookalike: 3.4,
  unlimitedApproval: 2.6,
  firstInteractionLargeValue: 2.1,
  freshRecipient: 1.8,
  highValue: 0.9, // log-scaled value term
  knownGood: -3.0,
};

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export interface ScamScore {
  /** Probability the transaction is a scam, 0-1. */
  probability: number;
  score: number; // 0-100 for parity with risk.ts
  level: "low" | "medium" | "high";
  reasons: string[];
  contributions: Record<string, number>;
}

export function scoreScam(tx: TxRequest): ScamScore {
  const reasons: string[] = [];
  const c: Record<string, number> = {};

  const add = (key: keyof typeof WEIGHTS, active: boolean | number, label?: string) => {
    const x = typeof active === "number" ? active : active ? 1 : 0;
    if (!x) return;
    const contribution = WEIGHTS[key] * x;
    c[key] = round(contribution);
    if (contribution > 0 && label) reasons.push(label);
  };

  const unlimited =
    tx.approvalAmount !== undefined && (!Number.isFinite(tx.approvalAmount) || tx.approvalAmount >= 1e30);
  const fresh = (tx.recipientAgeDays ?? 999) < 1;
  const valueTerm = Math.log10(Math.max(1, tx.valueUsd)) / 5; // 0..~1.2

  add("flaggedRecipient", !!tx.flaggedRecipient, "recipient flagged as scam/sanctioned");
  add("lookalike", !!tx.lookalikeOfKnown, "address-poisoning lookalike");
  add("unlimitedApproval", unlimited && !tx.knownGoodContract, "unlimited approval to unverified contract");
  add("firstInteractionLargeValue", !!tx.firstInteraction && tx.valueUsd > 1000, "large first-time transfer");
  add("freshRecipient", fresh && tx.valueUsd > 0, "recipient wallet just created");
  add("highValue", valueTerm);
  add("knownGood", !!tx.knownGoodContract);

  const logit =
    WEIGHTS.bias +
    Object.entries(c).reduce((s, [, v]) => s + v, 0);
  const probability = round(sigmoid(logit));
  const score = Math.round(probability * 100);

  let level: ScamScore["level"] = "low";
  if (probability >= 0.7) level = "high";
  else if (probability >= 0.35) level = "medium";

  if (reasons.length === 0) reasons.push("no scam indicators in transaction features");
  return { probability, score, level, reasons, contributions: c };
}

export interface TxScreen {
  action: "allow" | "warn" | "block";
  scam: ScamScore;
  simulation: SimulatedEffect;
}

/** Combined pre-sign gate: simulate + classify, then decide. */
export function screenTransaction(tx: TxRequest): TxScreen {
  const simulation = simulateTransaction(tx);
  const scam = scoreScam(tx);
  const action = scam.level === "high" ? "block" : scam.level === "medium" ? "warn" : "allow";
  return { action, scam, simulation };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
