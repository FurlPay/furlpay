// ---------------------------------------------------------------------------
// @furlpay/google-mpc — types for Google Cloud MPC v1beta
//
// Google Cloud Multi-Party Compute is in PRIVATE PREVIEW (announced Oct 28,
// 2026). The types here are derived from the publicly described API surface at
// cloud.google.com/security/multi-party-compute/docs and Google's digital
// assets symposium materials. They represent FurlPay's proposed 2-of-3
// threshold-signing architecture, not a binding contract with the API.
//
// ECDSA on secp256k1 (Ethereum, Solana via secp256k1-program) and EdDSA on
// Ed25519 (Solana native) are the two signing algorithms relevant to FurlPay.
// ---------------------------------------------------------------------------

// ── Key circles ─────────────────────────────────────────────────────────────

/** Signing algorithm for the key circle. */
export type MpcAlgorithm = "ECDSA_SECP256K1" | "EDDSA_ED25519";

/** Which party holds a key share. */
export type ShareHolder = "GOOGLE_CLOUD" | "CUSTOMER" | "CUSTODIAN";

/** Lifecycle state of a key share. */
export type ShareState = "ACTIVE" | "PENDING_BACKUP" | "DESTROYED";

/** Lifecycle state of a key circle. */
export type KeyCircleState = "ACTIVE" | "PENDING_ACTIVATION" | "DESTROYED";

/**
 * A single share within a key circle.
 *
 * In a 2-of-3 configuration, three shares exist. Any two can produce a valid
 * threshold signature. The full private key is NEVER reconstructed — each
 * signer produces a partial signature with its share, and the partials are
 * combined into a full ECDSA/EdDSA signature that on-chain verifiers cannot
 * distinguish from a single-signer output.
 */
export interface KeyShare {
  /** Resource name: `projects/{p}/locations/{l}/keyCircles/{kc}/shares/{s}` */
  name: string;
  /** Who holds this share. */
  holder: ShareHolder;
  /** Current state. */
  state: ShareState;
  /** When the share was created. ISO 8601. */
  createTime: string;
  /** When the share was last backed up. ISO 8601. Absent if never backed up. */
  lastBackupTime?: string;
}

/**
 * A key circle groups the shares that together define a threshold-signing key.
 *
 * Google's concept: you create a key circle with N shares and a threshold T.
 * Any T shares can produce a valid signature. For FurlPay's 2-of-3 model:
 *   Share A → Google Cloud Confidential Space
 *   Share B → FurlPay's sovereign infrastructure
 *   Share C → Institutional custodian or customer-controlled HSM
 */
export interface KeyCircle {
  /** Resource name: `projects/{p}/locations/{l}/keyCircles/{kc}` */
  name: string;
  /** Human-readable name. */
  displayName: string;
  /** Signing algorithm. */
  algorithm: MpcAlgorithm;
  /** Number of shares required to sign (T in T-of-N). */
  threshold: number;
  /** Total shares in the circle (N in T-of-N). */
  totalShares: number;
  /** Current state. */
  state: KeyCircleState;
  /** ISO 8601 creation time. */
  createTime: string;
  /** The shares belonging to this circle. */
  shares: KeyShare[];
  /** The derived public key (hex-encoded, uncompressed for secp256k1). */
  publicKey: string;
  /** Labels for organization. */
  labels?: Record<string, string>;
}

/** Request to create a new key circle. */
export interface CreateKeyCircleRequest {
  parent: string; // "projects/{p}/locations/{l}"
  keyCircleId: string;
  displayName: string;
  algorithm: MpcAlgorithm;
  threshold: number;
  shareHolders: ShareHolder[];
  labels?: Record<string, string>;
}

// ── Signing ─────────────────────────────────────────────────────────────────

/** What kind of payload is being signed. */
export type PayloadType = "TRANSACTION_HASH" | "MESSAGE_HASH" | "RAW";

/** Metadata about the transaction being authorized — feeds the policy engine. */
export interface TransactionMetadata {
  /** Chain identifier. */
  chain: string;
  /** Destination address. */
  to: string;
  /** Native-token value in the chain's smallest unit, as a decimal string. */
  value: string;
  /** Token contract address, if this is a token transfer. */
  tokenContract?: string;
  /** Token amount in the token's smallest unit, as a decimal string. */
  tokenAmount?: string;
  /** Token symbol (e.g. "USDC", "USDT"). */
  tokenSymbol?: string;
  /** Human-readable description for audit and approval UIs. */
  description?: string;
}

/** Request to initiate a threshold-signing operation. */
export interface SignRequest {
  /** Resource name of the key circle. */
  keyCircleName: string;
  /** Raw hash to sign (hex-encoded). */
  payload: string;
  /** What the payload represents. */
  payloadType: PayloadType;
  /** Chain this signature is for (used by the policy engine). */
  chain?: string;
  /** Transaction metadata for policy evaluation. */
  transactionMetadata?: TransactionMetadata;
  /** Idempotency key — prevents double-signing on retries. */
  requestId?: string;
}

/** Policy engine decision for one policy. */
export interface PolicyDecision {
  /** Name of the policy that was evaluated. */
  policyName: string;
  /** Whether this policy permits or forbids the operation. */
  effect: "PERMIT" | "FORBID";
  /** Human-readable reason. */
  reason: string;
}

/** State of a signing operation. */
export type SignOperationState =
  | "PENDING"
  | "AWAITING_APPROVAL"
  | "SIGNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

/** Result of a signing operation. */
export interface SignResult {
  /** Operation resource name for polling. */
  operationName: string;
  /** Current state. */
  state: SignOperationState;
  /** The signature, hex-encoded. Present only when state is COMPLETED. */
  signature?: string;
  /** The public key that signed, hex-encoded. */
  publicKey?: string;
  /** Chain the signature is for. */
  chain?: string;
  /** Policy decisions from every evaluated policy. */
  policyDecisions: PolicyDecision[];
  /** Error message if state is FAILED. */
  error?: string;
  /** When the signing operation was created. ISO 8601. */
  createTime: string;
  /** When the signing operation completed. ISO 8601. */
  completeTime?: string;
}

// ── Policies (Cedar) ────────────────────────────────────────────────────────

/** Effect of a transaction policy. */
export type PolicyEffect = "PERMIT" | "FORBID";

/**
 * A transaction policy written in the Cedar policy language.
 *
 * Cedar (github.com/cedar-policy) is an open-source policy language created
 * by AWS and adopted by Google Cloud MPC for transaction authorization. Each
 * policy is a PERMIT or FORBID rule evaluated against every signing request.
 * The engine is default-deny: at least one PERMIT must match, and no FORBID
 * may match, for a request to proceed.
 */
export interface TransactionPolicy {
  /** Resource name: `projects/{p}/locations/{l}/keyCircles/{kc}/policies/{p}` */
  name: string;
  /** Human-readable name. */
  displayName: string;
  /** Cedar policy source code. */
  cedarPolicy: string;
  /** Whether this rule permits or forbids matching transactions. */
  effect: PolicyEffect;
  /** Whether the policy is currently active. */
  enabled: boolean;
  /** ISO 8601. */
  createTime: string;
  /** ISO 8601. */
  updateTime: string;
}

/** Request to create a new policy on a key circle. */
export interface CreatePolicyRequest {
  /** Parent key circle resource name. */
  keyCircleName: string;
  /** Policy id (unique within the key circle). */
  policyId: string;
  displayName: string;
  cedarPolicy: string;
  effect: PolicyEffect;
  enabled?: boolean;
}

// ── Confidential Space ──────────────────────────────────────────────────────

/**
 * Claims extracted from a Confidential Space attestation token.
 *
 * Confidential Space VMs emit a JWT signed by Google's attestation service.
 * The token proves the workload is running in a genuine TEE (AMD SEV-SNP or
 * Intel TDX), what container image is running, and that the VM has not been
 * tampered with.
 */
export interface ConfidentialSpaceClaims {
  /** The Google Cloud project number. */
  projectNumber: string;
  /** The project id. */
  projectId: string;
  /** Container image digest (sha256). */
  imageDigest: string;
  /** Container image reference. */
  imageReference: string;
  /** Hardware platform: "AMD_SEV_SNP" | "INTEL_TDX". */
  hwModel: string;
  /** Whether Secure Boot was enabled. */
  secureBootEnabled: boolean;
  /** Whether debug mode is disabled (must be true for production). */
  debugDisabled: boolean;
  /** Workload identity pool provider resource name. */
  workloadIdentityProvider?: string;
  /** Service account the workload runs as. */
  serviceAccount?: string;
  /** Full attestation token for forwarding. */
  rawToken: string;
}

// ── Client configuration ────────────────────────────────────────────────────

/** Configuration for the Google MPC client. */
export interface GoogleMpcConfig {
  /** Google Cloud project id. */
  projectId: string;
  /** Google Cloud location (e.g. "us-central1", "europe-west1"). */
  location: string;
  /** Service account key JSON (for JWT → access token exchange). */
  serviceAccountKey?: ServiceAccountKey;
  /** Pre-obtained access token (overrides service account key). */
  accessToken?: string;
  /** Override the base URL (for testing). Default: "https://mpc.googleapis.com" */
  baseUrl?: string;
  /** Request timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
  /** Maximum retry attempts. Default: 3. */
  maxRetries?: number;
}

/** Google Cloud service account key file contents. */
export interface ServiceAccountKey {
  type: "service_account";
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
}

// ── Seam types (for drop-in replacement of the mock) ────────────────────────

/**
 * Matches the interface from `@furlpay/security/mpc` so GoogleMpcSigner can
 * serve as a drop-in replacement for the mock's clientPartialSign/serverCoSign.
 */
export interface PartialSignature {
  share: "A" | "B" | "C";
  value: string;
}

export interface PolicyDecisionLike {
  approved: boolean;
  reasons?: string[];
}

export interface MpcSignResult {
  signature: string;
  cosigned: true;
  shares: ("A" | "B" | "C")[];
}
