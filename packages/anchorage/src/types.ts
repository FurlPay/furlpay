// ---------------------------------------------------------------------------
// @furlpay/anchorage — types for Anchorage Digital REST API
//
// Anchorage Digital is a federally chartered digital asset bank (OCC charter,
// granted Jan 2021). Their API provides institutional custody, trading,
// settlement, and compliance capabilities.
//
// PROPOSED INTEGRATION — requires Anchorage institutional onboarding. These
// types are derived from Anchorage's public API documentation at
// docs.anchorage.com. The actual API may differ from what's documented here.
// ---------------------------------------------------------------------------

// ── Vault management ────────────────────────────────────────────────────────

/** Vault temperature determines withdrawal latency and security level. */
export type VaultType = "HOT" | "WARM" | "COLD";

/** Vault lifecycle state. */
export type VaultStatus = "ACTIVE" | "FROZEN" | "PENDING";

/** A digital asset held in a vault. */
export interface VaultAsset {
  /** Asset identifier (e.g. "BTC", "ETH", "SOL", "USDC", "USDT"). */
  assetType: string;
  /** Balance in the asset's native unit, as a decimal string. */
  balance: string;
  /** USD-equivalent balance, as a decimal string. */
  balanceUsd: string;
  /** Deposit address for this asset on this vault. */
  address: string;
  /** Network the address is on (e.g. "ethereum", "solana"). */
  network: string;
}

/**
 * An Anchorage vault — a segregated container for digital assets.
 *
 * HOT vaults authorize withdrawals automatically (within policy limits).
 * WARM vaults require offline approval for large withdrawals.
 * COLD vaults require multi-party offline ceremonies.
 */
export interface AnchorageVault {
  vaultId: string;
  name: string;
  type: VaultType;
  assets: VaultAsset[];
  createdAt: string;
  status: VaultStatus;
}

// ── Transfers ───────────────────────────────────────────────────────────────

/** Transfer lifecycle state. */
export type TransferStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

/** Request to initiate a withdrawal/transfer from a vault. */
export interface TransferRequest {
  /** Source vault id. */
  sourceVaultId: string;
  /** Destination blockchain address or vault id. */
  destinationAddress: string;
  /** Asset to transfer (e.g. "USDC"). */
  assetType: string;
  /** Amount in the asset's native unit, as a decimal string. */
  amount: string;
  /** Network to use (e.g. "ethereum", "solana", "arbitrum"). */
  network: string;
  /** Optional memo/tag (used by some chains like XLM, XRP). */
  memo?: string;
  /**
   * Client-supplied idempotency key. Anchorage deduplicates requests with the
   * same externalId — safe to retry on network errors.
   */
  externalId?: string;
  /** Human-readable description for the audit trail. */
  description?: string;
}

/** Result of a transfer operation. */
export interface TransferResult {
  /** Anchorage-assigned transfer id. */
  transferId: string;
  /** Current state. */
  status: TransferStatus;
  /** On-chain transaction hash (once broadcast). */
  txHash?: string;
  /** Network fee paid, as a decimal string in the native asset. */
  fee?: string;
  /** ISO 8601 creation time. */
  createdAt: string;
  /** ISO 8601 completion time (once COMPLETED or FAILED). */
  completedAt?: string;
  /** Error message if status is FAILED. */
  error?: string;
}

// ── Address book ────────────────────────────────────────────────────────────

/** A trusted destination address. */
export interface TrustedAddress {
  addressId: string;
  address: string;
  network: string;
  label: string;
  assetType: string;
  /** Whether this address has passed compliance review. */
  verified: boolean;
  createdAt: string;
}

// ── Webhooks ────────────────────────────────────────────────────────────────

/** Webhook event types Anchorage can emit. */
export type WebhookEventType =
  | "TRANSFER_COMPLETED"
  | "TRANSFER_FAILED"
  | "DEPOSIT_DETECTED"
  | "POLICY_APPROVAL_REQUIRED"
  | "VAULT_CREATED"
  | "ADDRESS_ADDED"
  | "COMPLIANCE_ALERT";

/** An Anchorage webhook event. */
export interface AnchorageWebhookEvent {
  /** Unique event id for deduplication. */
  eventId: string;
  /** What happened. */
  eventType: WebhookEventType;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Event-specific payload. */
  payload: Record<string, unknown>;
  /** Ed25519 signature for verification (base64-encoded). */
  signature: string;
}

// ── Compliance ──────────────────────────────────────────────────────────────

/** KYC status for an organization or individual. */
export type KycStatus = "APPROVED" | "PENDING" | "REJECTED" | "EXPIRED";

/** Compliance status summary. */
export interface ComplianceStatus {
  kycStatus: KycStatus;
  amlScreeningPassed: boolean;
  sanctionsScreeningPassed: boolean;
  travelRuleCompliant: boolean;
  lastScreeningAt: string;
}

// ── Client configuration ────────────────────────────────────────────────────

/** Configuration for the Anchorage client. */
export interface AnchorageConfig {
  /** API access key (provided during institutional onboarding). */
  apiKey: string;
  /** Ed25519 private key in PEM format for request signing. */
  apiSecret: string;
  /** Override the base URL. Default: "https://api.anchorage.com" */
  baseUrl?: string;
  /** Request timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
  /** Maximum retry attempts. Default: 3. */
  maxRetries?: number;
}
