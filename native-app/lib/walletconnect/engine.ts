import { track } from "@/lib/analytics";
import { captureException } from "@/lib/observability";
import { scanTransaction } from "@/lib/txscan";
import type { ScanResult } from "@/lib/txscan";
import { unscannedResult } from "@/lib/txscan/types";
import { decodeRequest, type RequestIntent } from "./requests";
import {
  buildApprovedNamespaces,
  caipForChainId,
  chainIdFromCaip,
  isRequestAuthorized,
  negotiateNamespaces,
  REFUSED_METHODS,
  type NamespaceDecision,
} from "./policy";
import * as store from "./store";
import type { WalletConnectTransport, TransportEvents } from "./transport";
import {
  WC_ERRORS,
  type DisconnectReason,
  type SessionProposal,
  type SessionRequest,
  type TransportStatus,
  type WalletConnectEvent,
  type WalletConnectSession,
  type WcRpcError,
} from "./types";

// ---------------------------------------------------------------------------
// The WalletConnect engine.
//
// Owns the lifecycle: pair, negotiate, approve, route requests to the signer,
// respond, disconnect. The UI does not talk to the transport and the transport
// does not talk to the UI — everything crosses here, which is what makes the
// whole feature testable against MemoryTransport.
//
// THE CENTRAL INVARIANT: NOTHING IS SIGNED THAT THE USER DID NOT SEE.
//
// Every request goes through the same four steps, in this order, with no path
// around them:
//
//   1. AUTHORIZE  is this method/chain inside what the session was granted?
//   2. DECODE     can we turn the params into something renderable?
//   3. SCAN       what does it actually do, and how risky is it?
//   4. ASK        hand it to the UI and wait for a human.
//
// Step 4 is the one worth defending in writing. There is no auto-approve, no
// "trusted dApp" list, and no remembered decision — not because those are
// unimplementable but because every one of them converts a permission the user
// granted once into a permission that applies to transactions they never saw.
// A dApp with an approved session can prompt; it can never sign.
//
// A DECODE FAILURE IS A REJECTION, NOT A FALLBACK. When step 2 fails the dApp
// gets a JSON-RPC error. The alternative — showing the user raw hex and asking
// them to decide — is a confirmation screen that cannot describe what it is
// confirming, which is indistinguishable from no confirmation at all.
//
// REQUESTS ARE HANDLED ONE AT A TIME. `pendingRequest` is a single slot, not a
// queue of concurrently-presented prompts. Two signature sheets racing on one
// screen is how a user approves the second while looking at the first.
// ---------------------------------------------------------------------------

export interface EngineDeps {
  transport: WalletConnectTransport;
  /** The address sessions are granted for. Null when no wallet is available. */
  getAddress: () => Promise<string | null>;
  /**
   * Sign and (when `broadcast`) submit. Supplied by the caller so the engine
   * never imports a signer directly — the same reason the transport is injected.
   */
  signAndSend: (intent: RequestIntent, context: { origin: string; scan: ScanResult }) => Promise<unknown>;
  /** Addresses the app already knows, for the scanner's "unfamiliar" checks. */
  knownAddresses?: () => Record<string, string>;
}

export interface PendingProposal {
  proposal: SessionProposal;
  decision: NamespaceDecision;
}

export interface PendingRequest {
  request: SessionRequest;
  intent: RequestIntent;
  scan: ScanResult;
  session: WalletConnectSession;
}

type Listener = (event: WalletConnectEvent) => void;

export class WalletConnectEngine {
  private status: TransportStatus = "idle";
  private readonly listeners = new Set<Listener>();
  private pendingProposal: PendingProposal | null = null;
  private pendingRequest: PendingRequest | null = null;
  private started = false;

  constructor(private readonly deps: EngineDeps) {}

  // --- lifecycle ------------------------------------------------------------

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const events: TransportEvents = {
      onProposal: (p) => void this.handleProposal(p),
      onRequest: (r) => void this.handleRequest(r),
      onSessionDeleted: (topic, reason) => {
        store.removeSession(topic);
        this.emit({ type: "session_removed", topic, reason });
      },
      onSessionUpdated: (session) => {
        store.saveSession(session);
        this.emit({ type: "session_updated", session });
      },
      onStatus: (s) => {
        this.status = s;
        this.emit({ type: "status", status: s });
      },
    };

    const restored = await this.deps.transport.init(events);

    // The SDK is authoritative on what exists. Rows it does not confirm are
    // dropped rather than kept — see store.reconcile: a session we remember and
    // the relay has forgotten is not a session, and showing it gives the user a
    // revoke button for something that is already gone.
    const { dropped } = store.reconcile(restored);
    for (const topic of dropped) this.emit({ type: "session_removed", topic, reason: "expiry" });

    for (const topic of store.pruneExpired()) {
      this.emit({ type: "session_removed", topic, reason: "expiry" });
    }
  }

  async stop(): Promise<void> {
    await this.deps.transport.close();
    this.started = false;
    this.pendingProposal = null;
    this.pendingRequest = null;
  }

  /**
   * Sign-out teardown.
   *
   * Disconnects at the RELAY first, then clears local rows. That order matters:
   * clearing locally first would leave live sessions the app has forgotten
   * about — a dApp could still prompt the next user of the device, and nothing
   * in the UI would list the session to revoke it.
   */
  async disconnectAllForSignOut(): Promise<void> {
    for (const session of store.listSessions()) {
      try {
        await this.deps.transport.disconnect(session.topic);
      } catch (e) {
        // Best effort: a relay error must not stop sign-out. The local row is
        // removed regardless, and the session expires on its own deadline.
        captureException(e, { scope: "wc.signout.disconnect" });
      }
    }
    store.removeAllSessions();
  }

  // --- pairing --------------------------------------------------------------

  /** `uri` must already have passed parsePairingUri — the engine does not re-parse. */
  async pair(uri: string, origin: "qr" | "deeplink" | "paste"): Promise<void> {
    track("wc_pairing_started", { origin });
    await this.deps.transport.pair(uri);
  }

  // --- proposals ------------------------------------------------------------

  private async handleProposal(proposal: SessionProposal): Promise<void> {
    const decision = negotiateNamespaces(proposal);
    this.pendingProposal = { proposal, decision };

    track("wc_session_proposed", {
      dappHost: hostOf(proposal.dapp.url),
      chains: decision.chains.length,
    });

    // Not auto-rejected even when unapprovable. The user is standing in front
    // of a dApp that just showed them a QR code, and silence is the one outcome
    // they cannot debug — the screen explains which network or method FurlPay
    // cannot provide and lets them dismiss it.
    this.emit({ type: "proposal", proposal });
  }

  getPendingProposal(): PendingProposal | null {
    return this.pendingProposal;
  }

  async approveProposal(proposalId: number): Promise<WalletConnectSession> {
    const pending = this.pendingProposal;
    if (!pending || pending.proposal.id !== proposalId) {
      throw new Error("That connection request is no longer active.");
    }
    if (!pending.decision.approvable) {
      throw new Error("This site asked for something FurlPay cannot provide.");
    }
    if (pending.proposal.expiresAt <= Date.now()) {
      this.pendingProposal = null;
      throw new Error("This connection request expired. Ask the site for a new QR code.");
    }

    const address = await this.deps.getAddress();
    if (!address) throw new Error("No wallet address is available to connect with.");

    const namespaces = buildApprovedNamespaces(pending.decision, address);
    const session = await this.deps.transport.approveSession({ proposalId, namespaces });

    store.saveSession(session);
    this.pendingProposal = null;

    track("wc_session_decided", { dappHost: hostOf(session.dapp.url), approved: true });
    this.emit({ type: "proposal_resolved", id: proposalId, approved: true });
    this.emit({ type: "session_added", session });
    return session;
  }

  async rejectProposal(proposalId: number, reason: "user" | "unsupported" = "user"): Promise<void> {
    const pending = this.pendingProposal;
    this.pendingProposal = null;

    const error: WcRpcError =
      reason === "unsupported" ? { ...WC_ERRORS.UNSUPPORTED_CHAIN } : { ...WC_ERRORS.USER_REJECTED };
    await this.deps.transport.rejectSession(proposalId, error);

    if (pending) track("wc_session_decided", { dappHost: hostOf(pending.proposal.dapp.url), approved: false });
    this.emit({ type: "proposal_resolved", id: proposalId, approved: false });
  }

  // --- requests -------------------------------------------------------------

  private async handleRequest(request: SessionRequest): Promise<void> {
    const session = store.getSession(request.topic);
    if (!session) {
      // A request on a topic we have no grant for. Refused rather than ignored:
      // an unanswered request leaves the dApp spinning forever.
      await this.safeReject(request, { ...WC_ERRORS.SESSION_EXPIRED });
      return;
    }

    const host = hostOf(session.dapp.url);
    track("wc_request_received", { dappHost: host, method: request.method });

    // 1. AUTHORIZE — against the grant, on every request, not just at approval.
    const authorized = isRequestAuthorized(session, request.chainId, request.method);
    if (!authorized.ok) {
      const error: WcRpcError =
        authorized.reason === "refused"
          ? { code: WC_ERRORS.UNSUPPORTED_METHOD.code, message: REFUSED_METHODS[request.method] ?? WC_ERRORS.UNSUPPORTED_METHOD.message }
          : authorized.reason === "chain"
            ? { ...WC_ERRORS.UNSUPPORTED_CHAIN }
            : { ...WC_ERRORS.UNAUTHORIZED_METHOD };
      await this.safeReject(request, error);
      return;
    }

    if (request.expiresAt <= Date.now()) {
      await this.safeReject(request, { code: WC_ERRORS.INVALID_PARAMS.code, message: "Request expired." });
      return;
    }

    // Single-slot: see the header. A second prompt while one is open is
    // refused, so the user is never deciding between two sheets.
    if (this.pendingRequest) {
      await this.safeReject(request, {
        code: WC_ERRORS.INTERNAL.code,
        message: "FurlPay is already showing another request. Finish that one first.",
      });
      return;
    }

    // 2. DECODE
    const decoded = decodeRequest(request);
    if (!decoded.ok) {
      await this.safeReject(request, decoded.error);
      return;
    }

    // 3. SCAN
    const scan = await this.scanIntent(decoded.intent, host);

    store.touchSession(request.topic);
    this.pendingRequest = { request, intent: decoded.intent, scan, session };

    // 4. ASK
    this.emit({ type: "request", request });
  }

  /**
   * Scanning is best-effort and never blocks the prompt.
   *
   * A scanner failure yields `unscannedResult`, which renders as "this
   * transaction was not checked" — an honest gap. Refusing to show the request
   * because the scanner threw would let a scanner bug freeze a user's ability
   * to use any dApp.
   */
  private async scanIntent(intent: RequestIntent, origin: string): Promise<ScanResult> {
    if (intent.kind !== "transaction") {
      // Signatures are scanned by shape rather than simulated: there is no
      // transaction to run. The permit detection in requests.ts is what carries
      // the risk signal here, and it is surfaced by the UI directly.
      return {
        level: intent.kind === "typed_data" && intent.isPermit ? "caution" : "unknown",
        category: "signature",
        findings:
          intent.kind === "typed_data" && intent.isPermit
            ? [
                {
                  id: "permit_signature",
                  level: "caution",
                  title: "This signature grants spending permission",
                  detail:
                    "Signing this lets the site move tokens from your wallet later, without another prompt. " +
                    "It is not a login.",
                },
              ]
            : [],
        deltas: [],
        simulated: false,
        sources: ["local"],
      };
    }

    try {
      return await scanTransaction({
        chainId: intent.chainId,
        from: intent.from,
        to: intent.to,
        value: intent.value,
        data: intent.data,
        origin,
        knownAddresses: this.deps.knownAddresses?.(),
      });
    } catch (e) {
      captureException(e, { scope: "wc.scan" });
      return unscannedResult("The security check could not run for this transaction.");
    }
  }

  getPendingRequest(): PendingRequest | null {
    return this.pendingRequest;
  }

  async approveRequest(requestId: number): Promise<void> {
    const pending = this.pendingRequest;
    if (!pending || pending.request.id !== requestId) {
      throw new Error("That request is no longer active.");
    }

    const host = hostOf(pending.session.dapp.url);

    // Cleared BEFORE signing, not after. Signing can take a long time (a
    // hardware tap, a biometric prompt, a broadcast) and leaving the slot
    // occupied would reject every subsequent request with "already showing
    // another request" if this one is abandoned mid-flight.
    this.pendingRequest = null;

    try {
      const result = await this.deps.signAndSend(pending.intent, { origin: host, scan: pending.scan });
      await this.deps.transport.respondRequest({ topic: pending.request.topic, id: requestId, result });
      track("wc_request_decided", {
        dappHost: host,
        method: pending.request.method,
        approved: true,
        riskLevel: pending.scan.level,
      });
      this.emit({ type: "request_resolved", id: requestId, approved: true });
    } catch (e) {
      // The dApp is told, always. A signing failure that returns nothing leaves
      // it waiting on a promise that will never settle, and the user is left
      // looking at a site that appears frozen because of an error on the phone.
      captureException(e, { scope: "wc.sign" });
      await this.safeRespondError(pending.request, {
        code: WC_ERRORS.INTERNAL.code,
        message: (e as Error).message || WC_ERRORS.INTERNAL.message,
      });
      this.emit({ type: "request_resolved", id: requestId, approved: false });
      throw e;
    }
  }

  async rejectRequest(requestId: number): Promise<void> {
    const pending = this.pendingRequest;
    if (!pending || pending.request.id !== requestId) return;
    this.pendingRequest = null;

    await this.safeReject(pending.request, { ...WC_ERRORS.USER_REJECTED });
    track("wc_request_decided", {
      dappHost: hostOf(pending.session.dapp.url),
      method: pending.request.method,
      approved: false,
      riskLevel: pending.scan.level,
    });
    this.emit({ type: "request_resolved", id: requestId, approved: false });
  }

  // --- sessions -------------------------------------------------------------

  listSessions(): WalletConnectSession[] {
    return store.listSessions();
  }

  async disconnect(topic: string, reason: DisconnectReason = "user"): Promise<void> {
    // Relay first, local row second — same ordering argument as
    // disconnectAllForSignOut.
    await this.deps.transport.disconnect(topic);
    const session = store.getSession(topic);
    store.removeSession(topic);
    if (session) track("wc_session_disconnected", { dappHost: hostOf(session.dapp.url), by: reason === "dapp" ? "dapp" : "user" });
    this.emit({ type: "session_removed", topic, reason });
  }

  async disconnectAll(): Promise<void> {
    for (const session of store.listSessions()) {
      try {
        await this.disconnect(session.topic, "user");
      } catch (e) {
        captureException(e, { scope: "wc.disconnectAll" });
      }
    }
  }

  /** Tell a session the active chain changed, per EIP-1193. */
  async announceChain(topic: string, chainId: number): Promise<void> {
    await this.deps.transport.emitSessionEvent({
      topic,
      chainId: caipForChainId(chainId),
      event: { name: "chainChanged", data: chainId },
    });
  }

  async announceAccount(topic: string, address: string, chainId: number): Promise<void> {
    await this.deps.transport.emitSessionEvent({
      topic,
      chainId: caipForChainId(chainId),
      // accountsChanged carries an ARRAY per EIP-1193, even for one account.
      // Sending a bare string is accepted by some dApps and silently ignored by
      // others, which produces a wallet that "works" everywhere except the sites
      // that read the spec.
      event: { name: "accountsChanged", data: [address] },
    });
  }

  getStatus(): TransportStatus {
    return this.status;
  }

  // --- events ---------------------------------------------------------------

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: WalletConnectEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (e) {
        // One bad subscriber must not stop the others, and must not leave a
        // session half-recorded.
        captureException(e, { scope: "wc.listener" });
      }
    }
  }

  // --- helpers --------------------------------------------------------------

  private async safeReject(request: SessionRequest, error: WcRpcError): Promise<void> {
    await this.safeRespondError(request, error);
  }

  private async safeRespondError(request: SessionRequest, error: WcRpcError): Promise<void> {
    try {
      await this.deps.transport.rejectRequest({ topic: request.topic, id: request.id, error });
    } catch (e) {
      captureException(e, { scope: "wc.reject" });
    }
  }
}

/**
 * Host for display and analytics.
 *
 * Hand-parsed rather than `new URL()`: Hermes' URL implementation has differed
 * from Node's across RN versions, and a dApp URL is untrusted input that must
 * never throw on a confirmation screen.
 */
export function hostOf(url: string): string {
  const withoutScheme = url.replace(/^[a-z]+:\/\//i, "");
  const host = withoutScheme.split("/")[0]?.split("?")[0] ?? "";
  return host.toLowerCase() || url;
}

export { chainIdFromCaip };
