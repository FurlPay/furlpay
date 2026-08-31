"use client";

import { mipdStore, type EIP6963ProviderDetail, type Eip1193Provider } from "@/lib/wallet/mipd";

// ---------------------------------------------------------------------------
// The wallet-provider abstraction behind the connect modal.
//
// Built ON the EIP-6963 store this app already ships (lib/wallet/mipd.ts)
// rather than a second discovery mechanism. That store is the real thing: the
// page dispatches `eip6963:requestProvider` and every installed wallet answers,
// so `detect()` reports what is genuinely installed in THIS browser — it does
// not assume MetaMask exists because the button says MetaMask.
//
// Everything here talks EIP-1193 directly. There is no SDK to add: an injected
// wallet is reachable through `provider.request`, and the methods used are the
// four a connect flow actually needs.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//   * never asks for a seed phrase or private key — no wallet API exposes them
//     and any UI that asks is phishing;
//   * never calls eth_sendTransaction or eth_signTransaction. Connecting reads
//     an address and a chain id. Moving money is a separate, explicit step;
//   * never reports a connection the wallet did not confirm. A rejected request
//     surfaces as `rejected`, not as a silent retry or an optimistic success.
//
// WalletConnect (the QR-based protocol for phone wallets) is NOT implemented:
// it needs @walletconnect/ethereum-provider and a project id from a WalletConnect
// account, neither of which this deployment has. It is listed as unavailable
// with that reason rather than as a button that opens nothing.
// ---------------------------------------------------------------------------

/** How a wallet can fail to connect. Each maps to its own UI state. */
export type ConnectErrorKind =
  | "rejected" // user declined in the wallet
  | "not-detected" // no provider announced for this rdns
  | "wrong-network" // connected, but on a chain we do not support
  | "timeout" // the wallet never answered
  | "unavailable" // needs infrastructure this deployment lacks
  | "unknown";

export class WalletConnectError extends Error {
  readonly kind: ConnectErrorKind;
  constructor(kind: ConnectErrorKind, message: string) {
    super(message);
    this.name = "WalletConnectError";
    this.kind = kind;
  }
}

export interface WalletOption {
  /** Reverse-DNS id, matched against what EIP-6963 announces. */
  rdns: string;
  name: string;
  /** Where to get it, shown when the wallet is not detected. */
  installUrl: string;
  /** True when this deployment cannot connect it at all (see WalletConnect). */
  requiresInfrastructure?: boolean;
  /** Why, when `requiresInfrastructure` is set. */
  unavailableReason?: string;
}

/**
 * The wallets the modal offers by name.
 *
 * A wallet not in this list still appears if it announces itself — see
 * `listWallets`, which merges discovered providers in. The list exists to give
 * the common ones a stable order and an install link, not to gate them.
 */
export const KNOWN_WALLETS: WalletOption[] = [
  { rdns: "io.metamask", name: "MetaMask", installUrl: "https://metamask.io/download/" },
  {
    rdns: "walletconnect",
    name: "WalletConnect",
    installUrl: "https://walletconnect.com/",
    requiresInfrastructure: true,
    unavailableReason:
      "WalletConnect needs a project id and the WalletConnect SDK, which are not configured on this deployment.",
  },
  { rdns: "com.coinbase.wallet", name: "Coinbase Wallet", installUrl: "https://www.coinbase.com/wallet/downloads" },
  { rdns: "com.trustwallet.app", name: "Trust Wallet", installUrl: "https://trustwallet.com/download" },
  { rdns: "me.rainbow", name: "Rainbow", installUrl: "https://rainbow.me/download" },
];

/** Chains this app will transact on. Anything else is `wrong-network`. */
export const SUPPORTED_CHAINS: Record<number, { name: string; hex: string }> = {
  1: { name: "Ethereum", hex: "0x1" },
  8453: { name: "Base", hex: "0x2105" },
  42161: { name: "Arbitrum One", hex: "0xa4b1" },
  137: { name: "Polygon", hex: "0x89" },
};

export const DEFAULT_CHAIN_ID = 1;

export interface ListedWallet extends WalletOption {
  /** The announced provider, when this wallet is actually installed. */
  detail: EIP6963ProviderDetail | null;
  /** Data-URI icon the wallet announced, when installed. */
  icon: string | null;
  installed: boolean;
}

/**
 * The known wallets, annotated with whether they are really installed, plus any
 * other wallet that announced itself.
 *
 * Ordering is deliberate: installed wallets first, because a list whose first
 * card cannot connect is a list that wastes the user's first click.
 */
export function listWallets(discovered: EIP6963ProviderDetail[]): ListedWallet[] {
  const byRdns = new Map(discovered.map((d) => [d.info.rdns, d]));

  const known: ListedWallet[] = KNOWN_WALLETS.map((w) => {
    const detail = byRdns.get(w.rdns) ?? null;
    return { ...w, detail, icon: detail?.info.icon ?? null, installed: !!detail };
  });

  // Wallets that announced but are not in the curated list — the user has them
  // installed, so hiding them would be worse than an unfamiliar name.
  const extra: ListedWallet[] = discovered
    .filter((d) => !KNOWN_WALLETS.some((w) => w.rdns === d.info.rdns))
    .map((d) => ({
      rdns: d.info.rdns,
      name: d.info.name,
      installUrl: "",
      detail: d,
      icon: d.info.icon,
      installed: true,
    }));

  return [...known, ...extra].sort((a, b) => Number(b.installed) - Number(a.installed));
}

export interface Connection {
  address: string;
  chainId: number;
  /** The provider, kept so the caller can switch networks or listen for events. */
  provider: Eip1193Provider;
  rdns: string;
  name: string;
}

/** Milliseconds before a silent wallet is treated as a timeout. */
const CONNECT_TIMEOUT_MS = 60_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new WalletConnectError("timeout", "The wallet did not respond.")),
      ms
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** Is this wallet installed right now? */
export function detect(rdns: string): EIP6963ProviderDetail | null {
  return mipdStore.getProviders().find((p) => p.info.rdns === rdns) ?? null;
}

/**
 * Ask the wallet for an account.
 *
 * `eth_requestAccounts` is the ONLY permission requested. It returns addresses
 * and nothing else — no signing capability is granted by connecting, which is
 * why this step can be safely automatic while a transaction never is.
 */
export async function connect(wallet: ListedWallet): Promise<Connection> {
  if (wallet.requiresInfrastructure) {
    throw new WalletConnectError(
      "unavailable",
      wallet.unavailableReason ?? "This wallet is not available on this deployment."
    );
  }

  const detail = wallet.detail ?? detect(wallet.rdns);
  if (!detail) {
    throw new WalletConnectError("not-detected", `${wallet.name} is not installed in this browser.`);
  }

  let accounts: string[];
  try {
    accounts = (await withTimeout(
      detail.provider.request({ method: "eth_requestAccounts" }),
      CONNECT_TIMEOUT_MS
    )) as string[];
  } catch (e) {
    if (e instanceof WalletConnectError) throw e;
    // EIP-1193: 4001 is "user rejected request". Anything else is a genuine
    // failure and must not be reported as a rejection.
    const code = (e as { code?: number })?.code;
    if (code === 4001) {
      throw new WalletConnectError("rejected", "You declined the connection request.");
    }
    throw new WalletConnectError("unknown", (e as Error)?.message || "Could not reach the wallet.");
  }

  const address = accounts?.[0];
  if (!address) {
    throw new WalletConnectError("rejected", "No account was shared.");
  }

  let chainId = DEFAULT_CHAIN_ID;
  try {
    const raw = (await detail.provider.request({ method: "eth_chainId" })) as string;
    const parsed = Number.parseInt(raw, 16);
    if (Number.isFinite(parsed)) chainId = parsed;
  } catch {
    // A wallet that connects but will not report its chain is unusual; treat
    // the chain as unknown rather than assuming mainnet, so the network check
    // below can tell the user plainly.
    chainId = -1;
  }

  return {
    address,
    chainId,
    provider: detail.provider,
    rdns: wallet.rdns,
    name: wallet.name,
  };
}

/** Ask the wallet to move to a chain we support. */
export async function switchNetwork(conn: Connection, chainId: number): Promise<number> {
  const target = SUPPORTED_CHAINS[chainId];
  if (!target) throw new WalletConnectError("wrong-network", "That network is not supported.");
  try {
    await conn.provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: target.hex }],
    });
    return chainId;
  } catch (e) {
    const code = (e as { code?: number })?.code;
    if (code === 4001) throw new WalletConnectError("rejected", "You declined the network switch.");
    throw new WalletConnectError("unknown", `Could not switch to ${target.name}.`);
  }
}

/**
 * Forget the connection locally.
 *
 * EIP-1193 has no "disconnect" — a dapp cannot revoke its own permission, and
 * pretending otherwise would leave the user believing access was withdrawn when
 * it was not. The wallet's own UI is the only place that can do it, and the
 * modal says so.
 */
export function disconnect(): void {
  /* no persistent connection state is kept; the modal drops its reference. */
}

/** `0x7A3F…91D2` — the standard truncation, never a full address in chrome. */
export function shortAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function chainName(chainId: number): string {
  return SUPPORTED_CHAINS[chainId]?.name ?? `Chain ${chainId}`;
}

export function isSupportedChain(chainId: number): boolean {
  return chainId in SUPPORTED_CHAINS;
}
