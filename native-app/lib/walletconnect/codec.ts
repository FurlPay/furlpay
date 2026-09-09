import type { WalletKitTypes } from "@reown/walletkit";
import type { DappMetadata, SessionProposal, SessionRequest, WalletConnectSession } from "./types";

// ---------------------------------------------------------------------------
// SDK <-> FurlPay translation. PURE, and separated from ./walletkit.ts for one
// reason: testability.
//
// walletkit.ts imports `Core` and `WalletKit` as VALUES, which drags the relay
// client and its native dependency chain into anything that imports it — so it
// cannot be loaded under jest-expo at all. This file imports the SDK
// `type`-only, which TypeScript erases entirely, so it has no runtime
// dependency on the SDK and __tests__/walletkitCodec.test.ts can exercise every
// branch without a device.
//
// That matters because these functions are where a WalletConnect integration
// actually goes wrong. The failures are silent ones: a proposal whose chains
// are dropped reads as "this site asked for no supported network"; an expiry
// read in the wrong unit either rejects everything or expires nothing; a
// verifyContext quietly discarded removes the only anti-phishing signal the
// confirmation screen has.
// ---------------------------------------------------------------------------

/** Session lifetime assumed when the relay does not state one. */
const FALLBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;


interface NamespaceLike {
  chains?: string[];
  methods?: string[];
  events?: string[];
}

/**
 * Flatten CAIP-25 namespaces into plain chain and method lists.
 *
 * TWO SOURCES OF CHAINS, and both are used in the wild:
 *
 *   { "eip155":   { chains: ["eip155:1","eip155:137"], methods: [...] } }
 *   { "eip155:1": { methods: [...] } }          <- chain implied by the KEY
 *
 * Reading only `chains` drops every proposal written the second way, and the
 * user is told the site asked for no supported network when it asked for
 * Ethereum. Both are collected, de-duplicated, and returned together.
 */
export function flattenNamespaces(
  namespaces: Record<string, NamespaceLike> | undefined,
): { chains: string[]; methods: string[]; events: string[] } {
  const chains = new Set<string>();
  const methods = new Set<string>();
  const events = new Set<string>();

  for (const [key, ns] of Object.entries(namespaces ?? {})) {
    // A key of the form "namespace:reference" IS a chain id.
    if (key.includes(":")) chains.add(key);
    for (const chain of ns?.chains ?? []) chains.add(chain);
    for (const method of ns?.methods ?? []) methods.add(method);
    for (const event of ns?.events ?? []) events.add(event);
  }

  return { chains: [...chains], methods: [...methods], events: [...events] };
}

export function toProposal(args: WalletKitTypes.SessionProposal): SessionProposal {
  const params = args.params;
  const required = flattenNamespaces(params.requiredNamespaces as Record<string, NamespaceLike>);
  const optional = flattenNamespaces(params.optionalNamespaces as Record<string, NamespaceLike>);

  return {
    id: args.id,
    pairingTopic: params.pairingTopic ?? "",
    dapp: toDappMetadata(params.proposer?.metadata, args.verifyContext),
    requiredChains: required.chains,
    optionalChains: optional.chains,
    requiredMethods: required.methods,
    optionalMethods: optional.methods,
    // Events from both tiers: an event we cannot emit is filtered by policy.ts,
    // so over-collecting here is safe and under-collecting is not.
    events: [...new Set([...required.events, ...optional.events])],
    expiresAt: secondsToMs(params.expiryTimestamp) ?? Date.now() + 5 * 60_000,
    receivedAt: Date.now(),
  };
}

export function toRequest(args: WalletKitTypes.SessionRequest): SessionRequest {
  return {
    id: args.id,
    topic: args.topic,
    chainId: args.params.chainId,
    method: args.params.request.method,
    params: args.params.request.params,
    receivedAt: Date.now(),
    expiresAt:
      secondsToMs((args.params.request as { expiryTimestamp?: number }).expiryTimestamp) ??
      // The relay's default request TTL. Used only when the dApp sent none —
      // an absent expiry must not read as "already expired", which would reject
      // every request from an SDK that omits the field.
      Date.now() + 5 * 60_000,
  };
}

export interface SessionStructLike {
  topic: string;
  pairingTopic?: string;
  peer?: { metadata?: unknown };
  namespaces?: Record<string, { accounts?: string[]; chains?: string[]; methods?: string[]; events?: string[] }>;
  expiry?: number;
  verifyContext?: unknown;
}

export function toSession(session: SessionStructLike): WalletConnectSession {
  const accounts: string[] = [];
  const chains = new Set<string>();
  const methods = new Set<string>();
  const events = new Set<string>();

  for (const [key, ns] of Object.entries(session.namespaces ?? {})) {
    for (const account of ns?.accounts ?? []) {
      accounts.push(account);
      // An approved account is "eip155:1:0xabc…" — the chain is its first two
      // segments. Deriving chains from accounts as well as from `chains` means
      // a session still lists its networks when the relay returns only accounts.
      const parts = account.split(":");
      if (parts.length >= 3) chains.add(`${parts[0]}:${parts[1]}`);
    }
    if (key.includes(":")) chains.add(key);
    for (const chain of ns?.chains ?? []) chains.add(chain);
    for (const method of ns?.methods ?? []) methods.add(method);
    for (const event of ns?.events ?? []) events.add(event);
  }

  const now = Date.now();
  return {
    topic: session.topic,
    pairingTopic: session.pairingTopic ?? "",
    dapp: toDappMetadata(session.peer?.metadata, session.verifyContext),
    accounts,
    chains: [...chains],
    methods: [...methods],
    events: [...events],
    expiresAt: secondsToMs(session.expiry) ?? now + FALLBACK_TTL_MS,
    connectedAt: now,
    lastActivityAt: now,
  };
}

interface VerifyContextLike {
  verified?: { origin?: string; validation?: string; isScam?: boolean };
}

/**
 * dApp metadata plus the relay's verification of it.
 *
 * Every field from `metadata` is the dApp's own claim and is treated as
 * untrusted display text. `verified` is the relay's observation and is the only
 * part an impersonator cannot control — see the header.
 */
export function toDappMetadata(raw: unknown, verifyContext: unknown): DappMetadata {
  const meta = (raw ?? {}) as { name?: string; description?: string; url?: string; icons?: string[] };
  const verified = (verifyContext as VerifyContextLike | undefined)?.verified;

  return {
    name: typeof meta.name === "string" ? meta.name : "",
    description: typeof meta.description === "string" ? meta.description : "",
    url: typeof meta.url === "string" ? meta.url : "",
    icons: Array.isArray(meta.icons) ? meta.icons.filter((i): i is string => typeof i === "string") : [],
    verified: verified?.origin
      ? {
          origin: verified.origin,
          validation:
            verified.validation === "VALID" || verified.validation === "INVALID"
              ? verified.validation
              : "UNKNOWN",
          isScam: verified.isScam === true,
        }
      : undefined,
  };
}

/**
 * WalletConnect expiries are SECONDS since epoch; JS wants milliseconds.
 *
 * Returns undefined for anything non-finite rather than NaN. A NaN deadline
 * compares false against every clock, so an expiry check silently stops
 * expiring anything — the kind of bug that only shows up as a stale session
 * nobody can explain.
 */
function secondsToMs(seconds: number | undefined): number | undefined {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  return seconds * 1000;
}
