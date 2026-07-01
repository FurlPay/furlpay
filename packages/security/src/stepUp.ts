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
  | "withdraw";

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

export function requiresStepUp(ctx: StepUpContext): StepUpDecision {
  const methods: StepUpDecision["methods"] = ["webauthn", "totp"];

  if ((ctx.action === "transfer" || ctx.action === "withdraw") && (ctx.amountUsd ?? 0) >= STEP_UP_AMOUNT_USD) {
    return { required: true, methods, reason: `Amount >= $${STEP_UP_AMOUNT_USD} requires step-up MFA` };
  }
  if (ALWAYS_STEP_UP.includes(ctx.action)) {
    return { required: true, methods, reason: `Action "${ctx.action}" requires step-up MFA` };
  }
  return { required: false, methods, reason: "No step-up required" };
}
