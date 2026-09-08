// ---------------------------------------------------------------------------
// WalletConnect domain model.
//
// FurlPay is the WALLET side of the protocol: dApps propose, we approve, they
// send requests, we sign. That direction dictates every type here — there is no
// "connect to a wallet" anywhere, because we ARE the wallet.
//
// NO VENDOR TYPES. Nothing in this file imports @reown/walletkit or
// @walletconnect/*. The engine talks to `WalletConnectTransport` (transport.ts)
// and the SDK — when installed — implements that. Two reasons, both learned
// from lib/observability:
//
//   1. The SDK has a native dependency chain (async-storage, get-random-values)
//      that cannot be validated on Windows without a device build. Domain logic
//      that imports it cannot be unit tested at all.
//   2. WalletConnect has renamed its wallet SDK twice (@walletconnect/
//      web3wallet -> @reown/walletkit). Domain code that named those types
//      would have been rewritten twice for no behavioural change.
//
// CAIP FORMATS ARE USED AS-IS. `eip155:42161`, not `{ namespace, reference }`.
// The protocol speaks CAIP strings, dApps send CAIP strings, and re-modelling
// them into objects means parsing on the way in and serialising on the way out
// for the privilege of a type that adds nothing.
// ---------------------------------------------------------------------------

/** CAIP-2, e.g. "eip155:1". */
export type CaipChainId = string;
/** CAIP-10, e.g. "eip155:1:0xabc…". */
export type CaipAccountId = string;

export interface DappMetadata {
  name: string;
  description: string;
  /** The dApp's own claim about where it lives. NOT verified — see `verified`. */
  url: string;
  icons: string[];
  /**
   * The relay's verification of the origin that actually opened the session.
   *
   * The distinction is the entire anti-phishing story. `metadata.url` is a
   * string the dApp typed about itself; a clone of a real dApp puts the real
   * dApp's URL there. `verified.origin` is what the relay observed. When they
   * disagree, the user is looking at an impersonation and the UI must say so
   * rather than rendering the claimed name in bold next to a signature request.
   */
  verified?: {
    origin: string;
    /** Relay-side reputation, when the relay has an opinion. */
    validation: "VALID" | "INVALID" | "UNKNOWN";
    isScam?: boolean;
  };
}

/** A session the dApp has asked for but the user has not decided on yet. */
export interface SessionProposal {
  id: number;
  pairingTopic: string;
  dapp: DappMetadata;
  /** Chains the dApp will not function without. Rejecting one rejects the session. */
  requiredChains: CaipChainId[];
  /** Chains it would like. Declining these still leaves a usable session. */
  optionalChains: CaipChainId[];
  requiredMethods: string[];
  optionalMethods: string[];
  events: string[];
  expiresAt: number;
  receivedAt: number;
}

export interface WalletConnectSession {
  topic: string;
  pairingTopic: string;
  dapp: DappMetadata;
  /** CAIP-10 accounts we actually granted. */
  accounts: CaipAccountId[];
  chains: CaipChainId[];
  methods: string[];
  events: string[];
  expiresAt: number;
  connectedAt: number;
  /** Updated on every request so the UI can sort by "last used". */
  lastActivityAt: number;
}

/** A signing / RPC request arriving on an established session. */
export interface SessionRequest {
  id: number;
  topic: string;
  chainId: CaipChainId;
  method: string;
  /** Raw JSON-RPC params. Interpreted per method by `lib/walletconnect/methods.ts`. */
  params: unknown;
  receivedAt: number;
  expiresAt: number;
}

/**
 * JSON-RPC error codes we return to dApps.
 *
 * These are the CAIP-25 / EIP-1193 values, not invented ones. A dApp branches
 * on the code — 4001 means "show the user a retry button", 5100 means "this
 * wallet will never do this, stop asking" — so returning a plausible-looking
 * wrong code makes well-behaved dApps misbehave.
 */
export const WC_ERRORS = {
  USER_REJECTED: { code: 4001, message: "User rejected the request." },
  USER_REJECTED_CHAINS: { code: 4001, message: "User rejected the requested chains." },
  UNAUTHORIZED_METHOD: { code: 3001, message: "Unauthorized method." },
  UNSUPPORTED_METHOD: { code: 5101, message: "Unsupported method." },
  UNSUPPORTED_CHAIN: { code: 5100, message: "Unsupported chain." },
  UNSUPPORTED_ACCOUNTS: { code: 5103, message: "Unsupported accounts." },
  SESSION_EXPIRED: { code: 6000, message: "Session expired." },
  /** Ours: the signer refused, the RPC failed, the device could not sign. */
  INTERNAL: { code: -32603, message: "Internal wallet error." },
  INVALID_PARAMS: { code: -32602, message: "Invalid request parameters." },
} as const;

export type WcErrorKey = keyof typeof WC_ERRORS;

export interface WcRpcError {
  code: number;
  message: string;
}

/** Reason a session ended, for the UI and for analytics. */
export type DisconnectReason = "user" | "dapp" | "expiry" | "sign_out" | "kill_switch";

/** Events the engine emits. The UI subscribes rather than polling. */
export type WalletConnectEvent =
  | { type: "proposal"; proposal: SessionProposal }
  | { type: "proposal_resolved"; id: number; approved: boolean }
  | { type: "session_added"; session: WalletConnectSession }
  | { type: "session_updated"; session: WalletConnectSession }
  | { type: "session_removed"; topic: string; reason: DisconnectReason }
  | { type: "request"; request: SessionRequest }
  | { type: "request_resolved"; id: number; approved: boolean }
  | { type: "status"; status: TransportStatus };

export type TransportStatus =
  /** No SDK installed, or the feature flag is off. Nothing will ever arrive. */
  | "unavailable"
  | "idle"
  | "connecting"
  | "connected"
  /** Socket dropped; the transport is retrying on its own. */
  | "reconnecting"
  | "error";
