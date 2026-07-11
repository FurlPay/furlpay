import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// Append-only audit trail for security- and compliance-relevant events:
// auth events, HITL decisions, refunds, role/config changes. Every entry is
// ALSO emitted as a structured log line so it survives instance recycling via
// the log drain even while the in-memory copy is demo-grade. Production lands
// these in an append-only table (no UPDATE/DELETE grants) — the SOC2 evidence
// store.
// ---------------------------------------------------------------------------

export type AuditEvent =
  | "auth.login"
  | "auth.logout"
  | "auth.signup"
  | "auth.guest_login"
  | "auth.mfa_failed"
  | "payment.created"
  | "payment.settled"
  | "payment.blocked"
  | "payment.review_requested"
  | "payment.review_approved"
  | "payment.review_rejected"
  | "payment.refunded"
  | "transfer.executed"
  | "transfer.blocked"
  | "account.funded"
  | "account.locked"
  | "agent.key_registered"
  | "agent.key_revoked"
  | "agent.spend_authorized"
  | "agent.spend_denied"
  | "webhook.processed"
  | "webhook.failed"
  | "billing.checkout_created"
  | "billing.sandbox_upgrade"
  | "billing.subscription_started"
  | "billing.subscription_ended"
  // Ops console — privileged control-plane actions (append-only).
  | "ops.control_changed"
  | "ops.policy_changed"
  | "ops.settlement_rechecked"
  | "ops.security_acknowledged";

export interface AuditEntry {
  id: number;
  ts: string;
  event: AuditEvent;
  /** Acting user id (or "system" / "anonymous"). */
  actor: string;
  fields: Record<string, unknown>;
}

const MAX_ENTRIES = 20_000;

const g = globalThis as unknown as { __auditTrail?: { seq: number; entries: AuditEntry[] } };
const trail = () => (g.__auditTrail ??= { seq: 0, entries: [] });

export function audit(event: AuditEvent, actor: string, fields: Record<string, unknown> = {}): void {
  const t = trail();
  const entry: AuditEntry = {
    id: ++t.seq,
    ts: new Date().toISOString(),
    event,
    actor,
    fields,
  };
  t.entries.push(entry);
  if (t.entries.length > MAX_ENTRIES) t.entries.splice(0, t.entries.length - MAX_ENTRIES);
  log.info(`audit:${event}`, { actor, ...fields });
}

export function auditEntries(limit = 200): AuditEntry[] {
  const entries = trail().entries;
  return entries.slice(Math.max(0, entries.length - limit)).reverse();
}
