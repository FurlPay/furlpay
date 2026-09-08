import type {
  DisconnectReason,
  SessionProposal,
  SessionRequest,
  TransportStatus,
  WalletConnectSession,
  WcRpcError,
} from "./types";

// ---------------------------------------------------------------------------
// The seam between FurlPay's WalletConnect logic and the WalletConnect SDK.
//
// WHY A SEAM AT ALL — the same reasoning as lib/observability's Transport, and
// it has already paid for itself once: the wallet-side SDK has been renamed
// twice (@walletconnect/web3wallet -> @reown/walletkit) with a changed API each
// time. Everything above this interface — the pairing parser, the namespace
// negotiation, the request decoder, the risk gate, the confirmation UI, and
// every test covering them — is unaffected by that, because none of it names a
// vendor type.
//
// THE SECOND REASON IS TESTABILITY, and it is the bigger one. @reown/walletkit
// pulls in @walletconnect/react-native-compat, which needs
// react-native-get-random-values and @react-native-async-storage/async-storage
// — native modules. This repo is developed on Windows with no attached device
// (see lib/observability/index.ts for the same constraint). Domain logic that
// imported the SDK directly could not be unit tested AT ALL, so the parts of
// this feature most likely to contain a security bug would be the parts with no
// coverage. With this seam, `MemoryTransport` below runs the entire engine —
// pairing, proposal, approval, request, signature, disconnect — in Jest.
//
// INSTALLING THE REAL TRANSPORT. See ./README.md. Nothing here imports it;
// `loadWalletKitTransport()` resolves it dynamically and returns null when the
// package is absent, exactly as the Sentry adapter does. An app with no SDK
// installed reports status "unavailable" and the WalletConnect screens tell the
// user the feature is not available in this build — which is true, and is a
// better outcome than a bundler error at startup.
// ---------------------------------------------------------------------------

export interface TransportEvents {
  onProposal(proposal: SessionProposal): void;
  onRequest(request: SessionRequest): void;
  /** The dApp ended it, or the relay expired it. User-initiated goes the other way. */
  onSessionDeleted(topic: string, reason: DisconnectReason): void;
  onSessionUpdated(session: WalletConnectSession): void;
  onStatus(status: TransportStatus): void;
}

export interface WalletConnectTransport {
  readonly name: string;

  /**
   * Bring the relay connection up and replay whatever the SDK already holds.
   *
   * Returns the sessions restored from the SDK's own storage — this is what the
   * store reconciles against at launch, and why session restore does not need a
   * network round trip to be correct.
   */
  init(events: TransportEvents): Promise<WalletConnectSession[]>;

  /** Consume a `wc:` URI. Resolves when the relay accepts the pairing, NOT when the proposal arrives. */
  pair(uri: string): Promise<void>;

  approveSession(input: {
    proposalId: number;
    namespaces: Record<string, { chains: string[]; accounts: string[]; methods: string[]; events: string[] }>;
  }): Promise<WalletConnectSession>;

  rejectSession(proposalId: number, error: WcRpcError): Promise<void>;

  /** `result` is the JSON-RPC result — a signature hex, a transaction hash, or null. */
  respondRequest(input: { topic: string; id: number; result: unknown }): Promise<void>;

  rejectRequest(input: { topic: string; id: number; error: WcRpcError }): Promise<void>;

  disconnect(topic: string): Promise<void>;

  /** Tell live sessions the active chain or account changed. */
  emitSessionEvent(input: { topic: string; chainId: string; event: { name: string; data: unknown } }): Promise<void>;

  close(): Promise<void>;
}

/**
 * Resolve the real SDK-backed transport, or null when it is not installed.
 *
 * The import specifier is built at runtime so Metro does not try to resolve
 * `./walletkit` statically and fail the bundle in a build that has not
 * installed the SDK. This is the same trick lib/observability uses for Sentry,
 * for the same reason.
 */
export async function loadWalletKitTransport(): Promise<WalletConnectTransport | null> {
  try {
    const specifier = "./walletkit";
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      createWalletKitTransport?: () => WalletConnectTransport;
    };
    return mod.createWalletKitTransport?.() ?? null;
  } catch {
    // Absent adapter or absent SDK. Both mean the same thing to the caller —
    // this build cannot do WalletConnect — and neither is an error worth
    // reporting, because it is the expected state of a build that did not opt in.
    return null;
  }
}

// ---------------------------------------------------------------------------
// In-memory transport: the test double, and the thing that makes the engine
// testable end to end.
//
// It is NOT a mock in the sense the repo forbids (AGENTS.md / the no-fabricated
// -data rule): it never runs in a production path, it is never selected by
// fallback, and `createEngine` requires a transport to be passed explicitly, so
// there is no code path where a missing SDK silently becomes this. It exists so
// that `engine.test.ts` can drive a full pairing -> proposal -> approve ->
// request -> sign -> disconnect sequence deterministically.
// ---------------------------------------------------------------------------

export class MemoryTransport implements WalletConnectTransport {
  readonly name = "memory";

  events: TransportEvents | null = null;
  readonly paired: string[] = [];
  readonly responses: Array<{ topic: string; id: number; result: unknown }> = [];
  readonly rejections: Array<{ topic: string; id: number; error: WcRpcError }> = [];
  readonly rejectedProposals: Array<{ proposalId: number; error: WcRpcError }> = [];
  readonly disconnected: string[] = [];
  readonly emitted: Array<{ topic: string; chainId: string; event: { name: string; data: unknown } }> = [];

  constructor(private readonly restored: WalletConnectSession[] = []) {}

  async init(events: TransportEvents): Promise<WalletConnectSession[]> {
    this.events = events;
    events.onStatus("connected");
    return this.restored;
  }

  async pair(uri: string): Promise<void> {
    this.paired.push(uri);
  }

  async approveSession(input: {
    proposalId: number;
    namespaces: Record<string, { chains: string[]; accounts: string[]; methods: string[]; events: string[] }>;
  }): Promise<WalletConnectSession> {
    const ns = input.namespaces.eip155;
    const now = Date.now();
    return {
      topic: `topic-${input.proposalId}`,
      pairingTopic: `pairing-${input.proposalId}`,
      dapp: { name: "Test dApp", description: "", url: "https://example.com", icons: [] },
      accounts: ns?.accounts ?? [],
      chains: ns?.chains ?? [],
      methods: ns?.methods ?? [],
      events: ns?.events ?? [],
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
      connectedAt: now,
      lastActivityAt: now,
    };
  }

  async rejectSession(proposalId: number, error: WcRpcError): Promise<void> {
    this.rejectedProposals.push({ proposalId, error });
  }

  async respondRequest(input: { topic: string; id: number; result: unknown }): Promise<void> {
    this.responses.push(input);
  }

  async rejectRequest(input: { topic: string; id: number; error: WcRpcError }): Promise<void> {
    this.rejections.push(input);
  }

  async disconnect(topic: string): Promise<void> {
    this.disconnected.push(topic);
  }

  async emitSessionEvent(input: { topic: string; chainId: string; event: { name: string; data: unknown } }): Promise<void> {
    this.emitted.push(input);
  }

  async close(): Promise<void> {
    this.events?.onStatus("idle");
    this.events = null;
  }
}
