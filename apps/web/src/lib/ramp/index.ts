// ---------------------------------------------------------------------------
// lib/ramp — security infrastructure for on-ramp (fiat → crypto) and off-ramp
// (crypto → fiat) operations.
//
// Every ramp route imports from this barrel rather than reaching into
// individual files. The module provides:
//
//   rampGuard    — pre-flight security check (embargoed countries, KYC tier,
//                  amount limit, velocity, address verification)
//   rampCommit   — post-flight velocity recording
//   rampAudit    — append-only audit trail (7-year retention)
//   beneficiary  — encrypted bank-account records; verification needs a partner (none yet)
//   webhookVerify — FurlBridge (Transak) HS256-JWT webhook verification
// ---------------------------------------------------------------------------

export { rampGuard, rampCommit, type RampGuardInput, type RampGuardResult } from "./rampGuard";
export { recordRampAudit, type RampAuditAction, type RampAuditEntry } from "./rampAudit";
export {
  createBeneficiary,
  verifyBeneficiary,
  checkBeneficiaryEligibility,
  getUserBeneficiaries,
  type Beneficiary,
  type BeneficiaryStatus,
} from "./beneficiary";
export {
  verifyFurlBridgeWebhook,
  verifyHs256Jwt,
  WebhookSignatureError,
} from "./webhookVerify";
