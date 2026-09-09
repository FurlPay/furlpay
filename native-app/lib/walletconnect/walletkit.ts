import { Core } from "@walletconnect/core";
import { WalletKit, type WalletKitTypes } from "@reown/walletkit";

/** The SDK exports WalletKit as a class value, so the instance type has to be
 *  derived rather than imported. */
type WalletKitInstance = InstanceType<typeof WalletKit>;
import Constants from "expo-constants";
import { captureException } from "@/lib/observability";
import type { DisconnectReason, WalletConnectSession, WcRpcError } from "./types";
import { toProposal, toRequest, toSession, type SessionStructLike } from "./codec";
import type { TransportEvents, WalletConnectTransport } from "./transport";

// ---------------------------------------------------------------------------
// The ONE file in this app that imports the WalletConnect SDK.
//
// Everything else in lib/walletconnect/ speaks FurlPay's own domain types
// (transport.ts explains why). This adapter's whole job is translation, in both
// directions, and it is deliberately dumb: no policy, no risk decisions, no
// storage. If a rule about what may be signed appears in this file, it is in
// the wrong place — policy.ts and engine.ts own that, and they are the parts
// covered by tests that run without a relay.
//
// THE TRANSLATION THAT MATTERS MOST is `requiredNamespaces` /
// `optionalNamespaces` -> flat chain and method lists. CAIP-25 nests those per
// namespace ("eip155": { chains, methods, events }), and a proposal may name a
// chain in TWO places: in `chains`, or implied by a CAIP-2 key like
// "eip155:1". A translator that reads only `chains` silently drops every
// single-chain proposal written the second way — which is most of them from
// certain dApp SDKs — and the user sees "this site asked for no supported
// network" for a site asking for Ethereum. Both forms are collected here.
//
// VERIFY CONTEXT IS THE ANTI-PHISHING SIGNAL and is carried across verbatim.
// `proposal.params.proposer.metadata.url` is a string the dApp typed about
// itself; a clone of a real dApp puts the real dApp's URL there.
// `verifyContext.verified.origin` is what the relay OBSERVED. Dropping it here
// would leave the confirmation UI with nothing but the attacker's own claim.
// ---------------------------------------------------------------------------

/**
 * Relay project id.
 *
 * NOT A SECRET — it is a public routing identifier that appears in the relay
 * URL, which is why it is an EXPO_PUBLIC_ var rather than living server-side.
 * It is still REQUIRED: without it the relay refuses the connection, so the
 * transport reports itself unavailable rather than opening a socket that can
 * only fail.
 */
const PROJECT_ID = (process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "").trim();

/**
 * What the dApp sees about us in its own "connected to" UI.
 *
 * `redirect` is what brings the user BACK to FurlPay after they approve in a
 * browser-initiated flow. Without it the user approves, sits on the dApp's
 * page, and never learns the session succeeded — the single most common
 * "WalletConnect is broken" report.
 */
const METADATA = {
  name: "FurlPay",
  description: "FurlPay wallet",
  url: "https://furlpay.com",
  icons: ["https://furlpay.com/icon-512.png"],
  redirect: { native: "furlpay://", universal: "https://furlpay.com" },
};

export function createWalletKitTransport(): WalletConnectTransport | null {
  // Returning null (rather than throwing) keeps "not configured" a first-class
  // state all the way up to the screen, which says so plainly.
  if (!PROJECT_ID) return null;
  return new WalletKitTransport();
}

class WalletKitTransport implements WalletConnectTransport {
  readonly name = "walletkit";

  private kit: WalletKitInstance | null = null;
  private events: TransportEvents | null = null;
  /**
   * Detach closures, one per attached listener.
   *
   * Storing a CLOSURE rather than an (event, fn) pair keeps each handler's
   * argument type intact. Erasing them into a common tuple loses the link
   * between the event name and its payload type, and `off()` then has to be
   * called through a cast that would silently accept a mismatched pair.
   */
  private detachers: Array<() => void> = [];

  async init(events: TransportEvents): Promise<WalletConnectSession[]> {
    this.events = events;
    events.onStatus("connecting");

    try {
      const core = new Core({ projectId: PROJECT_ID });
      this.kit = await WalletKit.init({ core, metadata: METADATA });
    } catch (e) {
      events.onStatus("error");
      throw e;
    }

    const onProposal = (args: WalletKitTypes.SessionProposal) => {
      try {
        events.onProposal(toProposal(args));
      } catch (e) {
        // A malformed proposal must not take the process down. It is remote
        // input; the worst acceptable outcome is that this one is ignored.
        captureException(e, { scope: "wc.walletkit.proposal" });
      }
    };

    const onRequest = (args: WalletKitTypes.SessionRequest) => {
      try {
        events.onRequest(toRequest(args));
      } catch (e) {
        captureException(e, { scope: "wc.walletkit.request" });
      }
    };

    const onDelete = (args: { topic: string }) => {
      // "dapp": the relay only delivers session_delete when the OTHER side ends
      // it. A user-initiated disconnect goes through disconnect() below and
      // never round-trips through this handler.
      events.onSessionDeleted(args.topic, "dapp" satisfies DisconnectReason);
    };

    const onProposalExpire = () => {
      // The pending proposal is gone. The engine holds one slot and clears it
      // on any resolution; re-emitting status is what nudges a mounted sheet to
      // re-read that now-empty slot instead of waiting on a user who can no
      // longer approve anything.
      events.onStatus("connected");
    };

    this.attach("session_proposal", onProposal);
    this.attach("session_request", onRequest);
    this.attach("session_delete", onDelete);
    this.attach("proposal_expire", onProposalExpire);
    this.attach("session_request_expire", onProposalExpire);

    events.onStatus("connected");

    // The SDK's own store is the source of truth for what already exists, and
    // it is available synchronously after init — which is why session restore
    // needs no network round trip.
    return Object.values(this.kit.getActiveSessions() ?? {}).map((s) => toSession(s as SessionStructLike));
  }

  private attach<E extends WalletKitTypes.Event>(
    event: E,
    fn: (args: WalletKitTypes.EventArguments[E]) => void,
  ): void {
    const kit = this.kit;
    if (!kit) return;
    kit.on(event, fn);
    this.detachers.push(() => kit.off(event, fn));
  }

  private require(): WalletKitInstance {
    if (!this.kit) throw new Error("WalletConnect is not started.");
    return this.kit;
  }

  async pair(uri: string): Promise<void> {
    // activatePairing defaults true; being explicit documents that this opens
    // the pairing topic immediately rather than queuing it.
    await this.require().pair({ uri, activatePairing: true });
  }

  async approveSession(input: {
    proposalId: number;
    namespaces: Record<string, { chains: string[]; accounts: string[]; methods: string[]; events: string[] }>;
  }): Promise<WalletConnectSession> {
    const session = await this.require().approveSession({
      id: input.proposalId,
      namespaces: input.namespaces,
    });
    return toSession(session);
  }

  async rejectSession(proposalId: number, error: WcRpcError): Promise<void> {
    await this.require().rejectSession({ id: proposalId, reason: error });
  }

  async respondRequest(input: { topic: string; id: number; result: unknown }): Promise<void> {
    await this.require().respondSessionRequest({
      topic: input.topic,
      response: { id: input.id, jsonrpc: "2.0", result: input.result },
    });
  }

  async rejectRequest(input: { topic: string; id: number; error: WcRpcError }): Promise<void> {
    await this.require().respondSessionRequest({
      topic: input.topic,
      // A JSON-RPC ERROR response, not a result of null. A dApp branches on
      // `error.code` — 4001 means "show a retry", 5100 means "stop asking" —
      // and a null result reads as success to most client SDKs.
      response: { id: input.id, jsonrpc: "2.0", error: input.error },
    });
  }

  async disconnect(topic: string): Promise<void> {
    await this.require().disconnectSession({
      topic,
      // 6000 USER_DISCONNECTED, the CAIP-25 code for exactly this.
      reason: { code: 6000, message: "User disconnected." },
    });
  }

  async emitSessionEvent(input: {
    topic: string;
    chainId: string;
    event: { name: string; data: unknown };
  }): Promise<void> {
    await this.require().emitSessionEvent(input);
  }

  async close(): Promise<void> {
    // Detach before dropping the reference: an orphaned listener holding a
    // closure over the old engine would keep delivering into a torn-down
    // session on the next sign-in.
    for (const detach of this.detachers) {
      try {
        detach();
      } catch (e) {
        captureException(e, { scope: "wc.walletkit.off" });
      }
    }
    this.detachers = [];
    this.events?.onStatus("idle");
    this.kit = null;
    this.events = null;
  }
}

/** Exposed for the release-config test; not used at runtime. */
export const WALLETCONNECT_METADATA = METADATA;
export const WALLETCONNECT_CONFIGURED = PROJECT_ID.length > 0;
