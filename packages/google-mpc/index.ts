// ---------------------------------------------------------------------------
// @furlpay/google-mpc — barrel exports
//
// Google Cloud MPC v1beta client for FurlPay's 2-of-3 threshold signing.
// PROPOSED INTEGRATION — Google Cloud MPC is in private preview (Oct 2026).
// ---------------------------------------------------------------------------

// Types
export type {
  MpcAlgorithm,
  ShareHolder,
  ShareState,
  KeyCircleState,
  KeyShare,
  KeyCircle,
  CreateKeyCircleRequest,
  PayloadType,
  TransactionMetadata,
  SignRequest,
  PolicyDecision,
  SignOperationState,
  SignResult,
  PolicyEffect,
  TransactionPolicy,
  CreatePolicyRequest,
  ConfidentialSpaceClaims,
  GoogleMpcConfig,
  ServiceAccountKey,
  PartialSignature,
  PolicyDecisionLike,
  MpcSignResult,
} from "./src/types.js";

// Client
export { GoogleMpcClient } from "./src/client.js";

// Cedar policy helpers
export {
  maxTransactionAmount,
  allowedRecipients,
  requireApproval,
  velocityLimit,
  sanctionsCheck,
  allowedChains,
  businessHoursOnly,
  validateCedarSyntax,
  type CedarPolicyDef,
} from "./src/cedar.js";

// Confidential Space attestation
export {
  verifyAttestationToken,
  clearJwksCache,
  type VerifyAttestationOptions,
} from "./src/confidential-space.js";

// Integration seam (drop-in replacement for @furlpay/security mock)
export {
  GoogleMpcSigner,
  configFromEnv,
  type GoogleMpcSignerConfig,
} from "./src/seam.js";
