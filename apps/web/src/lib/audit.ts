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
  // Apple Pay top-up. A capture that succeeded but failed to credit is the
  // one state that needs a human: the money moved and the balance did not.
  | "topup.applePay.settled"
  | "topup.applePay.failed"
  | "topup.applePay.amount_mismatch"
  | "topup.applePay.credit_failed"
  | "travel.cancelled"
  // Travel-document wallet. The DELETED event deliberately carries no document
  // detail — an erasure record must not become the surviving copy of the data.
  | "passport.session_created"
  | "passport.verified"
  | "passport.deleted"
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
  // First contact from Discord: one snowflake, one FurlPay account.
  | "account.discord_provisioned"
  | "wallet.link_challenge_issued"
  | "wallet.link_established"
  | "wallet.link_rejected"
  // Wallet-handle reservation: which account claimed which pre-launch handle,
  // and the read scopes granted at consent.
  | "wallet.handle_reserved"
  // Payout destination lifecycle. A wallet change is the single highest-value
  // action a compromised account can take, so every step of proving control of
  // one is recorded — including the failures.
  // Checkout sessions. session_created and status_changed together give the
  // full path a payment took, which is what makes a fabricated status
  // impossible to hide after the fact.
  | "checkout.session_created"
  | "checkout.status_changed"
  | "payout.freeze_requested"
  | "payout.unfreeze_requested"
  | "payout.challenge_issued"
  | "payout.ownership_verified"
  | "payout.ownership_failed"
  | "agent.key_registered"
  | "agent.key_revoked"
  | "agent.spend_authorized"
  | "agent.spend_denied"
  // API key lifecycle. Never carries secret material: a key id and a name are
  // enough to investigate an incident, and a hash in a log is a hash that has
  // left the key store.
  | "apikey.created"
  | "apikey.rotated"
  | "apikey.revoked"
  | "apikey.updated"
  | "apikey.deleted"
  | "apikey.auth_failed"
  // MPC co-signing. `mpc.signed` records that a spendable signature was minted
  // — the closest thing in this system to "money left", since a signature is
  // irreversible once broadcast. Logged with the digest, which is public the
  // moment the transaction lands and identifies it uniquely.
  | "mpc.signed"
  | "mpc.sign_denied"
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
