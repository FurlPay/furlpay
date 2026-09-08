import type { ChainSlug } from "@/lib/evm/rpc";
import type { CaipChainId, SessionProposal } from "./types";

// ---------------------------------------------------------------------------
// What FurlPay will and will not agree to over WalletConnect.
//
// THIS FILE IS THE SECURITY BOUNDARY OF THE WHOLE FEATURE. A session's approved
// namespaces are the permission grant: every request the dApp is later allowed
// to make was decided here, once, at approval time. Getting it wrong is not a
// bug that shows up as a broken screen — it is a dApp holding a permission the
// user never knowingly gave, for as long as the session lives.
//
// SO THE RULE IS: APPROVE THE INTERSECTION, NEVER THE REQUEST.
//
// The tempting implementation is to echo back whatever the proposal asked for,
// because that makes every dApp work on the first try. It also means a
// malicious proposal listing `eth_sendTransaction` on sixty chains gets exactly
// that. What is granted here is the intersection of (what the dApp asked for)
// and (what this wallet supports), and never a superset of either.
//
// UNSUPPORTED REQUIRED CHAINS REJECT THE SESSION. CAIP-25 is explicit that
// `requiredNamespaces` are non-negotiable: approving a session while silently
// dropping a required chain produces a dApp that believes it has Optimism and
// discovers otherwise halfway through a transaction. Optional chains are the
// opposite — dropping those is exactly what "optional" means.
// ---------------------------------------------------------------------------

/**
 * EVM chains this wallet can sign for, mapped to the RPC proxy's slugs.
 *
 * Sourced from lib/evm/rpc.ts ChainSlug rather than redeclared: a chain the RPC
 * proxy will not serve cannot be signed for usefully, so the two lists must not
 * be able to drift apart. Adding a chain means adding it to CHAIN_REGISTRY
 * server-side first — the client cannot invent an endpoint.
 */
export const SUPPORTED_EVM_CHAINS: Record<number, { slug: ChainSlug; name: string }> = {
  1: { slug: "ethereum", name: "Ethereum" },
  137: { slug: "polygon", name: "Polygon" },
  8453: { slug: "base", name: "Base" },
  42161: { slug: "arbitrum", name: "Arbitrum One" },
};

/**
 * JSON-RPC methods this wallet implements.
 *
 * A CLOSED LIST, and short on purpose. Every entry is a method whose params
 * this app can decode and render honestly to the user before signing. A method
 * we cannot render is a method the user would be approving blind, so it is not
 * here — `wallet_addEthereumChain` in particular is absent because the app
 * cannot add an RPC endpoint (the proxy holds them server-side), and pretending
 * otherwise would return success for something that did not happen.
 */
export const SUPPORTED_METHODS = [
  "eth_sendTransaction",
  "eth_signTransaction",
  "personal_sign",
  "eth_signTypedData",
  "eth_signTypedData_v4",
  "wallet_switchEthereumChain",
] as const;

export type SupportedMethod = (typeof SUPPORTED_METHODS)[number];

/**
 * Methods we explicitly refuse, with the reason shown to the user.
 *
 * Recorded rather than merely absent because "unsupported" and "refused" are
 * different answers and a developer integrating a dApp deserves the second one.
 * `eth_sign` is the one that matters: it signs an arbitrary 32-byte digest with
 * no domain separation, so a dApp can hand over the hash of a transaction and
 * have the user "sign a message" that is in fact a transfer. No modern wallet
 * offers it and neither does this one.
 */
export const REFUSED_METHODS: Record<string, string> = {
  eth_sign:
    "eth_sign signs raw data with no way to show you what it means — it has been used to drain wallets. FurlPay will not do it.",
  wallet_addEthereumChain:
    "FurlPay's supported networks are configured server-side and cannot be added by a site.",
  wallet_watchAsset: "Add tokens from the FurlPay token screen instead, where the contract can be verified.",
};

export const SUPPORTED_EVENTS = ["chainChanged", "accountsChanged"] as const;

export function caipForChainId(chainId: number): CaipChainId {
  return `eip155:${chainId}`;
}

/** `eip155:42161` -> 42161. Null for anything that is not an EVM CAIP-2 id. */
export function chainIdFromCaip(caip: CaipChainId): number | null {
  const [namespace, reference] = caip.split(":");
  if (namespace !== "eip155") return null;
  const id = Number(reference);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function chainSlugFromCaip(caip: CaipChainId): ChainSlug | null {
  const id = chainIdFromCaip(caip);
  return id === null ? null : (SUPPORTED_EVM_CHAINS[id]?.slug ?? null);
}

export function chainNameFromCaip(caip: CaipChainId): string {
  const id = chainIdFromCaip(caip);
  return (id !== null && SUPPORTED_EVM_CHAINS[id]?.name) || caip;
}

export function isSupportedChain(caip: CaipChainId): boolean {
  const id = chainIdFromCaip(caip);
  return id !== null && id in SUPPORTED_EVM_CHAINS;
}

export function isSupportedMethod(method: string): method is SupportedMethod {
  return (SUPPORTED_METHODS as readonly string[]).includes(method);
}

/** The outcome of negotiating a proposal against this wallet's abilities. */
export interface NamespaceDecision {
  /** False when a REQUIRED chain or method cannot be honoured. */
  approvable: boolean;
  /** Chains that would be granted. Intersection, never a superset. */
  chains: CaipChainId[];
  methods: string[];
  events: string[];
  /**
   * Required things we cannot do. Non-empty implies `approvable === false`,
   * and these strings are what the rejection screen shows the user.
   */
  unsupportedRequired: string[];
  /** Optional things dropped. Shown as "this site also asked for…", not an error. */
  droppedOptional: string[];
}

/**
 * Negotiate a proposal.
 *
 * Pure, and deliberately so: this is the function whose behaviour determines
 * what a session may do, so it must be exhaustively testable without a relay,
 * a socket or an SDK. See __tests__/policy.test.ts.
 */
export function negotiateNamespaces(proposal: SessionProposal): NamespaceDecision {
  const unsupportedRequired: string[] = [];
  const droppedOptional: string[] = [];

  const chains: CaipChainId[] = [];
  for (const chain of proposal.requiredChains) {
    if (isSupportedChain(chain)) chains.push(chain);
    else unsupportedRequired.push(chainNameFromCaip(chain));
  }
  for (const chain of proposal.optionalChains) {
    if (chains.includes(chain)) continue;
    if (isSupportedChain(chain)) chains.push(chain);
    else droppedOptional.push(chainNameFromCaip(chain));
  }

  const methods: string[] = [];
  for (const method of proposal.requiredMethods) {
    if (isSupportedMethod(method)) methods.push(method);
    else if (method in REFUSED_METHODS) unsupportedRequired.push(method);
    else unsupportedRequired.push(method);
  }
  for (const method of proposal.optionalMethods) {
    if (methods.includes(method)) continue;
    // A refused method is never granted, not even as optional. "Optional" is
    // the dApp's assessment of its own needs, not a permission slip.
    if (method in REFUSED_METHODS) droppedOptional.push(method);
    else if (isSupportedMethod(method)) methods.push(method);
    else droppedOptional.push(method);
  }

  const events = proposal.events.filter((e) => (SUPPORTED_EVENTS as readonly string[]).includes(e));

  // A session with no chain cannot carry a single request, so approving it
  // would create a connected-looking dApp that fails on first use.
  const approvable = unsupportedRequired.length === 0 && chains.length > 0 && methods.length > 0;

  if (chains.length === 0 && unsupportedRequired.length === 0) {
    unsupportedRequired.push("no supported network");
  }
  if (methods.length === 0 && unsupportedRequired.length === 0) {
    unsupportedRequired.push("no supported request type");
  }

  return { approvable, chains, methods, events, unsupportedRequired, droppedOptional };
}

/**
 * The CAIP-25 namespace object handed back to the relay on approval.
 *
 * `accounts` is the cartesian product of granted chains and the wallet address:
 * the protocol wants a CAIP-10 per (chain, account), and omitting one silently
 * removes that chain from the dApp's view even though we granted it.
 */
export function buildApprovedNamespaces(
  decision: NamespaceDecision,
  address: string,
): Record<string, { chains: string[]; accounts: string[]; methods: string[]; events: string[] }> {
  const accounts = decision.chains.map((chain) => `${chain}:${address}`);
  return {
    eip155: {
      chains: decision.chains,
      accounts,
      methods: decision.methods,
      events: decision.events.length > 0 ? decision.events : [...SUPPORTED_EVENTS],
    },
  };
}

/**
 * Is this request inside what the session was granted?
 *
 * Checked on EVERY request, not just at approval. A session's permissions can
 * be narrowed later (the user revokes a chain), and a relay message is an
 * untrusted input regardless — a dApp that asks for a method outside its grant
 * gets 3001 rather than a signing prompt.
 */
export function isRequestAuthorized(
  session: { chains: CaipChainId[]; methods: string[] },
  chainId: CaipChainId,
  method: string,
): { ok: true } | { ok: false; reason: "chain" | "method" | "refused" } {
  if (method in REFUSED_METHODS) return { ok: false, reason: "refused" };
  if (!session.chains.includes(chainId)) return { ok: false, reason: "chain" };
  if (!session.methods.includes(method)) return { ok: false, reason: "method" };
  return { ok: true };
}
