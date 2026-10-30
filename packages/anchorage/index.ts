// ---------------------------------------------------------------------------
// @furlpay/anchorage — barrel exports
// ---------------------------------------------------------------------------

// Types
export type {
  VaultType,
  VaultStatus,
  VaultAsset,
  AnchorageVault,
  TransferStatus,
  TransferRequest,
  TransferResult,
  TrustedAddress,
  WebhookEventType,
  AnchorageWebhookEvent,
  KycStatus,
  ComplianceStatus,
  AnchorageConfig,
} from "./src/types.js";

// Ed25519 request signing
export {
  canonicalRequest,
  signCanonical,
  verifyCanonical,
  authHeaders,
} from "./src/auth.js";

// REST client
export { AnchorageClient } from "./src/client.js";

// Webhook verification
export {
  verifyWebhook,
  EventDeduplicator,
  dispatchWebhook,
  type WebhookVerifierConfig,
  type WebhookVerifyResult,
  type WebhookHandlers,
} from "./src/webhooks.js";
