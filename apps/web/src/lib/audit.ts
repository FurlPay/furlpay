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
  | "auth.logout.epoch_fallback"
  | "auth.logout.not_durable"
  | "x402.checkout.paid"
  | "x402.checkout.refused"
  | "auth.signup"
  | "auth.guest_login"
  | "auth.dev_session"
  | "auth.mfa_failed"
  // The positive counterpart. Only failures were recorded, so the log could show
  // that a step-up was never *rejected* but never that one actually *ran* — and
  // "this $20,000 order was biometrically approved, here is the record" is
  // exactly the question a dispute asks.
  | "auth.mfa_passed"
  // Privileged-role provisioning (lib/compliance/roleGrants.ts). A role that
  // reaches customer dossiers is granted by two people and removable by one;
  // these four are the record of who did which, and they are what an
  // investigation reads to answer "who could see this, and since when".
  | "rbac.grant_requested"
  | "rbac.grant_approved"
  | "rbac.grant_rejected"
  | "rbac.grant_revoked"
  | "auth.mfa_enrolled"
  | "auth.mfa_enabled"
  | "auth.mfa_disabled"
  | "payment.created"
  | "payment.settled"
  | "payment.blocked"
  | "payment.review_requested"
  | "payment.review_approved"
  | "payment.review_rejected"
  // A human answering a control-plane approval (app/api/control-plane/approvals).
  | "control_plane.approval.approved"
  | "control_plane.approval.denied"
  | "payment.refunded"
  | "transfer.executed"
  | "transfer.blocked"
  | "transfer.held"
  // Apple Pay top-up. A capture that succeeded but failed to credit is the
  // one state that needs a human: the money moved and the balance did not.
  | "topup.applePay.settled"
  | "topup.applePay.failed"
  | "topup.applePay.amount_mismatch"
  | "topup.applePay.credit_failed"
  | "travel.cancelled"
  | "travel.settle.confirmed"
  | "travel.settle.rejected"
  // Travel-document wallet. The DELETED event deliberately carries no document
  // detail — an erasure record must not become the surviving copy of the data.
  | "passport.session_created"
  | "passport.verified"
  | "passport.deleted"
  // Content platform. `lead_captured` is the consent record for a report
  // download or webinar registration; `leads_exported` records an admin
  // pulling the contact list, which is the action that most needs a trail.
  | "content.lead_captured"
  | "research.verification_sent"
  | "research.verification_consumed"
  | "research.download_issued"
  | "content.leads_exported"
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
  | "watch.scope_denied"
  | "auth.watch_token_issued"
  | "account.funded"
  | "account.locked"
  | "profile.updated"
  | "profile.username_changed"
  // Account erasure. Deliberately survives the deletion it records: audit_log
  // has no FK to users precisely so the trail outlives the account (0002).
  | "account.deleted"
  // First contact from Discord: one snowflake, one FurlPay account.
  // DM verification: captcha, email, phone, wallet. Failures are recorded
  // too — a token used by the wrong holder is a signal, not noise.
  // Admin reads of another person's financial data. Looking is an event,
  // not a non-event: who looked, at whom, and at what.
  | "admin.users_listed"
  | "admin.user_inspected"
  | "admin.access_denied"
  | "verify.step_issued"
  | "verify.step_completed"
  | "verify.step_failed"
  | "verify.completed"
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
  | "settlement.onboarding.screened"
  | "settlement.onboarding.activated"
  | "settlement.onboarding.started"
  | "settlement.onboarding.step_completed"
  | "settlement.onboarding.document_uploaded"
  | "settlement.onboarding.document_replaced"
  | "settlement.onboarding.document_removed"
  | "settlement.onboarding.screening_requested"
  | "settlement.onboarding.screening_completed"
  | "settlement.onboarding.screening_blocked"
  | "settlement.onboarding.screening_failed"
  | "settlement.onboarding.identity_verification_started"
  | "settlement.onboarding.review_requested"
  | "settlement.onboarding.review_reopened"
  | "settlement.onboarding.review_document_decided"
  | "settlement.onboarding.review_screening_decided"
  | "settlement.onboarding.review_approved"
  | "settlement.onboarding.review_rejected"
  | "settlement.onboarding.review_changes_requested"
  | "settlement.onboarding.review_document_opened"
  | "settlement.onboarding.settlement_configuration_updated"
  | "settlement.onboarding.activation_requested"
  | "settlement.onboarding.activation_blocked"
  | "compliance.case_opened"
  | "compliance.case_action"
  | "compliance.monitoring_evaluated"
  | "compliance.report_exported"
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
  | "developer.ramp_webhook_set"
  | "developer.ramp_webhook_cleared"
  | "recipient.attested"
  | "recipient.revoked"
  | "recipient.destination_revoked"
  // MPC co-signing. `mpc.signed` records that a spendable signature was minted
  // — the closest thing in this system to "money left", since a signature is
  // irreversible once broadcast. Logged with the digest, which is public the
  // moment the transaction lands and identifies it uniquely.
  | "mpc.signed"
  | "mpc.sign_denied"
  // Signing authorization — the ticket a signer demands before it will act.
  // Granted only when simulation, attestation, confirmation and the payload
  // about to be signed all committed to the SAME canonical digest; refused
  // when they did not; replay_blocked when a spent authorization was presented
  // again. These three are what an incident review reads to answer "what did
  // we authorise, and what else tried to use it".
  | "signing.authorization_granted"
  | "signing.authorization_refused"
  | "signing.replay_blocked"
  // Device and app-instance registry. A device identifier the CLIENT chooses is
  // a suggestion, not an identity; these record what the SERVER concluded and
  // when, which is what a "was this really their phone?" investigation reads.
  | "device.registered"
  | "device.registration_refused"
  | "device.attestation_verified"
  | "device.attestation_failed"
  | "device.key_rotated"
  | "device.revoked"
  // Signing challenge — proof that the live, present, correct device is asking
  // now, which is a different question from whether the transaction is allowed.
  | "challenge.created"
  | "challenge.consumed"
  | "challenge.replay_detected"
  | "webhook.processed"
  | "webhook.failed"
  // Same provider event id delivered with a DIFFERENT body (payload hash
  // mismatch in webhook_events, migration 0022) — a forged replay; never processed.
  | "webhook.payload_mismatch"
  // An on-chain deposit to the shared treasury: recorded, credited to no one,
  // because a shared address carries no evidence of whose money it is.
  | "deposit.unattributed"
  // A deposit to a user's OWN (self-custody) wallet: activity only, no balance claim.
  | "deposit.self_custody_observed"
  // An admin MUTATION (non-GET) that passed requireRole("admin"): recorded and alerted.
  | "admin.action"
  // An admin READ (GET/HEAD/OPTIONS): recorded, throttled, not alerted (lib/adminAudit.ts).
  | "admin.read"
  // A provider event in a currency the credit path does not convert: not credited.
  | "webhook.unsupported_currency"
  | "billing.checkout_created"
  | "billing.sandbox_upgrade"
  | "ambassadors.followed"
  | "ambassadors.unfollowed"
  | "ambassadors.unauthorized_patch_attempt"
  | "ambassadors.profile_updated"
  | "authority.request_created"
  | "authority.request_verified"
  | "authority.request_staged"
  | "authority.request_approved"
  | "authority.request_disclosed"
  | "authority.request_rejected"
  | "billing.subscription_started"

  | "billing.subscription_ended"
  // Ops console — privileged control-plane actions (append-only).
  | "ops.control_changed"
  | "ops.policy_changed"
  | "ops.settlement_rechecked"
  | "ops.ramp_partner_enabled"
  | "ops.ramp_partner_disabled"
  | "ops.security_acknowledged"
  | "ops.settlement_safety_tripped"
  | "ops.settlement_safety_recovered"
  | "ops.settlement_safety_approval"
  | "circle.user_initialized"
  | "circle.transfer_challenge_created";

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
