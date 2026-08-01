/**
 * Why a transaction was refused.
 *
 * Machine-readable `reason` plus a human `message`, kept separate on purpose: a
 * UI needs a sentence, telemetry needs a stable key, and deriving either from
 * the other produces log lines that change when copy is edited.
 */
export class GuardRejection extends Error {
  readonly reason: RejectionReason;

  constructor(reason: RejectionReason, message: string) {
    super(message);
    this.name = "GuardRejection";
    this.reason = reason;
  }
}

export type RejectionReason =
  // chain binding
  | "chain_mismatch"
  | "unsupported_chain"
  // shape
  | "no_transaction"
  | "bad_target"
  | "no_calldata"
  | "bad_value"
  | "bad_gas_limit"
  | "bad_fees"
  | "bad_transaction"
  // approvals
  | "bad_spender"
  | "bad_token"
  | "bad_amount"
  // freshness
  | "no_expiry"
  | "expired"
  // action registry
  | "unknown_action"
  | "action_disabled"
  | "endpoint_mismatch"
  | "method_mismatch"
  | "malformed_body"
  | "missing_field"
  | "invalid_field"
  | "amount_out_of_range";

/** Narrowing helper, so callers can branch without `instanceof` gymnastics. */
export function isGuardRejection(error: unknown): error is GuardRejection {
  return error instanceof GuardRejection;
}
