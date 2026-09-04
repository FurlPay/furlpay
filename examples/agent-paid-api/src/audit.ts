// ---------------------------------------------------------------------------
// The audit trail: why was this agent allowed to spend this money?
//
// Append-only, in memory for the example. The point it demonstrates is the
// SHAPE — every decision references the principal, the agent, the intent and
// the reservation, so an operator can reconstruct the authority that existed
// at the moment of the decision rather than the authority that exists now.
//
// NOTHING SENSITIVE IS RECORDED. No keys, no seed phrases, no bearer tokens,
// no raw payment payloads. A payer address and an amount are the facts an
// auditor needs; the signing material is not.
// ---------------------------------------------------------------------------

export type AuditEventType =
  | "POLICY_ALLOWED"
  | "POLICY_DENIED"
  | "BUDGET_RESERVED"
  | "BUDGET_RELEASED"
  | "BUDGET_COMMITTED"
  | "PAYMENT_SUBMITTED"
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_UNKNOWN"
  | "SETTLEMENT_COMPLETED"
  | "SETTLEMENT_FAILED"
  | "LEDGER_COMMITTED"
  | "IDEMPOTENT_REPLAY"
  | "AGENT_REVOKED";

export interface AuditEvent {
  at: string;
  type: AuditEventType;
  principalId?: string;
  agentId?: string;
  paymentIntentId?: string;
  reservationId?: string;
  requestId?: string;
  endpoint?: string;
  amountAtomic?: string;
  detail?: string;
}

export class AuditLog {
  private readonly events: AuditEvent[] = [];

  record(event: Omit<AuditEvent, "at">): AuditEvent {
    const full: AuditEvent = { at: new Date().toISOString(), ...event };
    this.events.push(full);
    return full;
  }

  /** Everything, oldest first. Never filtered by success — a denial is the
   *  most interesting row in an audit. */
  all(): readonly AuditEvent[] {
    return this.events;
  }

  forIntent(paymentIntentId: string): readonly AuditEvent[] {
    return this.events.filter((e) => e.paymentIntentId === paymentIntentId);
  }
}
