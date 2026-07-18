import { log } from "@/lib/log";
import { enqueueAudit } from "@/lib/auditDb";

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
  | "auth.mfa_enrolled"
  | "auth.mfa_enabled"
  | "auth.mfa_disabled"
  | "payment.created"
  | "payment.settled"
  | "payment.blocked"
  | "payment.review_requested"
  | "payment.review_approved"
  | "payment.review_rejected"
  | "payment.refunded"
  | "transfer.executed"
  | "transfer.blocked"
  | "travel.cancelled"
  | "travel.rewards_claimed"
  | "auth.handoff_minted"
  | "auth.handoff_redeemed"
  // MCP connector (Claude): who granted which scopes, and when a token was
  // minted against that grant. A connector that can prepare payments is exactly
  // the thing that needs an audit trail.
  | "mcp.consent_granted"
  | "mcp.token_issued"
  | "mcp.token_refreshed"
  | "mcp.token_revoked"
  | "mcp.scope_denied"
  | "account.funded"
  | "account.locked"
  | "profile.updated"
  // Account erasure. Deliberately survives the deletion it records: audit_log
  // has no FK to users precisely so the trail outlives the account (0002).
  | "account.deleted"
  | "wallet.link_challenge_issued"
  | "wallet.link_established"
  | "wallet.link_rejected"
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

  // Durable sink. The in-memory ring above is per-lambda and evicts under
  // load, so it is a debugging convenience, NOT the compliance record — the
  // `audit_log` table is. enqueueAudit never throws; an audit failure must not
  // fail the action being audited.
  enqueueAudit({ event, actor, fields, ts: entry.ts });
}

export function auditEntries(limit = 200): AuditEntry[] {
  const entries = trail().entries;
  return entries.slice(Math.max(0, entries.length - limit)).reverse();
}
