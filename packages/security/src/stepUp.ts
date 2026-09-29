// ---------------------------------------------------------------------------
// Step-up authentication policy. High-value or sensitive actions require a
// second factor (FIDO2 hardware key preferred, TOTP as backup) before the MPC
// server share will co-sign.
// ---------------------------------------------------------------------------

export type SensitiveAction =
  | "transfer"
  | "set_card_limits"
  | "change_settlement_priority"
  | "add_payee"
  | "reveal_card"
  | "withdraw"
  // ── Actions the iOS Guardian app can dispatch ──────────────────────────────
  //
  // Added because the gate on those was client-side only. Guardian's
  // `ServiceContainer.confirmAndDispatch` puts Face ID in front of every
  // money-moving action, but `BiometricGate` returns a local Bool from LAContext
  // and nothing about it reached the server. Measured across all seven endpoints
  // Guardian can reach: zero enforced step-up, zero biometric proof, zero MFA. A
  // bearer token alone authorised a $25,000 investing order.
  //
  // These names make those actions expressible to this policy, so the same
  // threshold that has always governed `transfer` now governs them too.
  | "create_payment"
  | "swap"
  | "place_order"
  | "schedule_investment"
  | "earn_deposit";

export interface StepUpContext {
  action: SensitiveAction;
  amountUsd?: number;
}

export interface StepUpDecision {
  required: boolean;
  methods: Array<"webauthn" | "totp">;
  reason: string;
}

// Value threshold above which any money movement needs step-up.
export const STEP_UP_AMOUNT_USD = 5000;

const ALWAYS_STEP_UP: SensitiveAction[] = [
  "set_card_limits",
  "change_settlement_priority",
  "add_payee",
  "reveal_card",
];

/**
 * Actions gated by VALUE rather than by kind.
 *
 * `transfer` and `withdraw` were the original two and keep their exact previous
 * behaviour. The five Guardian actions join them rather than getting a threshold
 * of their own: a $10,000 investing order and a $10,000 transfer are the same
 * amount of the user's money leaving on the say-so of the same session, and two
 * numbers in two places is how they end up disagreeing.
 */
const VALUE_GATED: SensitiveAction[] = [
  "transfer",
  "withdraw",
  "create_payment",
  "swap",
  "place_order",
  "schedule_investment",
  "earn_deposit",
];

export function requiresStepUp(ctx: StepUpContext): StepUpDecision {
  const methods: StepUpDecision["methods"] = ["webauthn", "totp"];

  if (VALUE_GATED.includes(ctx.action) && (ctx.amountUsd ?? 0) >= STEP_UP_AMOUNT_USD) {
    return { required: true, methods, reason: `Amount >= $${STEP_UP_AMOUNT_USD} requires step-up MFA` };
  }
  if (ALWAYS_STEP_UP.includes(ctx.action)) {
    return { required: true, methods, reason: `Action "${ctx.action}" requires step-up MFA` };
  }
  return { required: false, methods, reason: "No step-up required" };
}
