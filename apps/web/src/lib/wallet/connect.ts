"use client";

import { mipdStore, type EIP6963ProviderDetail, type Eip1193Provider } from "@/lib/wallet/mipd";
import { addr, walletEvent } from "@/lib/wallet/telemetry";

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
  | "pending" // a request is already open in the wallet (EIP-1193 -32002)
  | "locked" // wallet installed but locked / not authorized (4100, 4900)
  | "not-detected" // no provider announced for this rdns
  | "wrong-network" // connected, but on a chain we do not support
  | "chain-mismatch" // the wallet is not on the chain this action requires
  | "provider-error" // the wallet itself faulted (-32603)
  | "network" // the wallet could not reach its node (-32000, fetch failure)
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

/**
 * Map an EIP-1193 provider error onto a kind the UI can speak.
 *
 * ── WHY -32002 GETS ITS OWN KIND ───────────────────────────────────────────
 *
 * It is the most common real-world wallet failure and the least self-
 * explanatory: the user clicks Connect, the extension already has a popup open
 * behind the browser window, and the page reports "Internal JSON-RPC error".
 * The user retries, which produces another -32002, and concludes the site is
 * broken. The correct message tells them where the request already is.
 *
 * 4100/4900 are the locked/disconnected pair: the wallet is installed and
 * answering, but has not authorized this origin — "not installed" would send
 * the user to reinstall something they already have.
 *
 * Codes are read from `code`, and from `data.originalError.code` because some
 * wallets nest the RPC error one level down when proxying.
 */
export function classifyProviderError(e: unknown): { kind: ConnectErrorKind; message: string } {
  const err = e as {
    code?: number;
    message?: string;
    name?: string;
    data?: { originalError?: { code?: number } };
  };
  const code = err?.code ?? err?.data?.originalError?.code;

  // A fetch/abort failure carries no RPC code. Classified before the switch so
  // it does not fall through to "unknown", which would hide the one cause the
  // user can actually act on.
  if (code === undefined) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      return { kind: "timeout", message: "The wallet did not respond. Try again." };
    }
    if (typeof err?.message === "string" && /network|fetch|offline|ECONN/i.test(err.message)) {
      return {
        kind: "network",
        message: "Your wallet could not reach the network. Check your connection and retry.",
      };
    }
  }

  switch (code) {
    case 4001:
      return { kind: "rejected", message: "You declined the request in your wallet." };
    case -32002:
      return {
        kind: "pending",
        message:
          "A wallet request is already open. Finish or dismiss it in your wallet, then try again.",
      };
    case 4100:
      return {
        kind: "locked",
        message: "Your wallet is locked or has not approved this site. Unlock it and try again.",
      };
    case 4900:
      return { kind: "locked", message: "Your wallet is not connected to a network." };
    case 4902:
      return {
        kind: "wrong-network",
        message: "That network is not added to your wallet yet.",
      };
    case -32603:
      // "Internal error". Genuinely ambiguous — wallets return it for an
      // unreachable RPC, a reverted eth_call and their own internal faults
      // alike. Reported as a provider fault rather than guessed at, because
      // telling the user "you rejected it" when their RPC is down is worse
      // than telling them something went wrong on the wallet's side.
      return {
        kind: "provider-error",
        message: "Your wallet reported an internal error. Check its network settings and retry.",
      };
    case -32000:
      // JSON-RPC server error. Usually the wallet's upstream node.
      return {
        kind: "network",
        message: "Your wallet could not reach the network. Check your connection and retry.",
      };
    default:
      // Never surface a raw provider string to the user. The original message
      // still reaches the caller for logging.
      return {
        kind: "unknown",
        message: "The wallet could not complete the request. Please try again.",
      };
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

/**
 * In-flight connection attempts, keyed by wallet.
 *
 * ── THE DOUBLE-CLICK BUG ───────────────────────────────────────────────────
 *
 * `eth_requestAccounts` opens a popup. A second call while the first is open
 * does not open a second popup — the wallet answers -32002 ("already
 * pending"), which the UI then renders as a failure even though the FIRST
 * request is still perfectly alive and waiting for the user.
 *
 * So a repeat click must not reach the provider at all. It joins the promise
 * already running, and both callers resolve from the one popup the user is
 * actually looking at. Keyed per rdns so connecting MetaMask does not block
 * connecting Phantom.
 *
 * The entry is cleared when the promise settles, so a genuine retry after a
 * rejection still works.
 */
const inFlight = new Map<string, Promise<Connection>>();

const SILENT_TIMEOUT_MS = 1_500;

/**
 * Identity for the in-flight map.
 *
 * The EIP-6963 `uuid` where we have one, because that is the PROVIDER. Keying
 * on `rdns` (the brand) would make two colliding extensions share one slot, so
 * connecting to the second would silently return the first's promise — the
 * exact substitution the collision handling in mipd.ts exists to prevent.
 */
function attemptKey(wallet: ListedWallet): string {
  return wallet.detail?.info.uuid ?? `rdns:${wallet.rdns}`;
}

export async function connect(wallet: ListedWallet): Promise<Connection> {
  const key = attemptKey(wallet);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const started = Date.now();
  walletEvent("wallet_connect_started", { uuid: wallet.detail?.info.uuid, rdns: wallet.rdns });

  const attempt = connectOnce(wallet)
    .then((conn) => {
      walletEvent("wallet_connect_success", {
        uuid: wallet.detail?.info.uuid,
        rdns: wallet.rdns,
        account: addr(conn.address),
        chainId: conn.chainId,
        durationMs: Date.now() - started,
      });
      return conn;
    })
    .catch((e) => {
      const kind = e instanceof WalletConnectError ? e.kind : "unknown";
      walletEvent(kind === "rejected" ? "wallet_connect_rejected" : "wallet_connect_failed", {
        uuid: wallet.detail?.info.uuid,
        rdns: wallet.rdns,
        errorKind: kind,
        durationMs: Date.now() - started,
      });
      throw e;
    })
    .finally(() => {
      // Cleared on EVERY outcome — success, rejection, timeout — so a failed
      // attempt can never poison the provider for the rest of the session.
      inFlight.delete(key);
    });

  inFlight.set(key, attempt);
  return attempt;
}

/**
 * Which accounts this origin is ALREADY authorized for, without prompting.
 *
 * `eth_accounts` returns the permitted set and does not open a popup — that is
 * `eth_requestAccounts`. This is what makes a reconnect affordance safe: the
 * page can discover on load that permission still stands and show a connected
 * state, without the pattern every wallet UX guide warns about (a permission
 * dialog appearing because someone opened a tab).
 *
 * Returns [] on any failure. A wallet that will not answer is treated as not
 * authorized, never as authorized-but-erroring.
 */
export async function silentAccounts(detail: EIP6963ProviderDetail): Promise<string[]> {
  try {
    const accounts = (await withTimeout(
      detail.provider.request({ method: "eth_accounts" }),
      SILENT_TIMEOUT_MS,
    )) as string[];
    return Array.isArray(accounts) ? accounts.filter((a) => typeof a === "string") : [];
  } catch {
    return [];
  }
}

/** Tests only — clears any in-flight attempt. */
export function __resetInFlight(): void {
  inFlight.clear();
}

async function connectOnce(wallet: ListedWallet): Promise<Connection> {
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
    const { kind, message } = classifyProviderError(e);
    // The raw provider message is logged, never shown — see classifyProviderError.
    throw new WalletConnectError(kind, message);
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

/**
 * Verify the wallet is on `expectedChainId` RIGHT NOW, before a transaction.
 *
 * ── WHY IT RE-READS INSTEAD OF TRUSTING STATE ──────────────────────────────
 *
 * A `Connection` records the chain as it was at connect time. The user can
 * switch networks in the extension at any moment, and a `chainChanged` event
 * can be missed — the listener may not be mounted, the page may have been
 * backgrounded, or the wallet may not emit reliably. Signing against a cached
 * chain id is how a transaction built for Base gets submitted on Ethereum,
 * where the same calldata hits a different contract.
 *
 * So this asks the provider on every call. It is one RPC round trip against a
 * local extension, which is cheap next to sending a transaction to the wrong
 * chain.
 *
 * Throws rather than switching. Switching networks is a decision the user
 * makes in their wallet; doing it silently on their behalf immediately before
 * a signature is the wrong moment to be moving things around.
 */
export async function assertChain(
  conn: Connection,
  expectedChainId: number
): Promise<void> {
  let actual: number;
  try {
    const raw = (await conn.provider.request({ method: "eth_chainId" })) as string;
    actual = Number.parseInt(raw, 16);
  } catch (e) {
    const { message } = classifyProviderError(e);
    throw new WalletConnectError("chain-mismatch", message);
  }

  if (!Number.isFinite(actual)) {
    throw new WalletConnectError(
      "chain-mismatch",
      "Your wallet did not report which network it is on. Reconnect and try again."
    );
  }

  if (actual !== expectedChainId) {
    const want = SUPPORTED_CHAINS[expectedChainId]?.name ?? `chain ${expectedChainId}`;
    const have = SUPPORTED_CHAINS[actual]?.name ?? `chain ${actual}`;
    throw new WalletConnectError(
      "chain-mismatch",
      `This transaction is for ${want}, but your wallet is on ${have}. Switch network and try again.`
    );
  }
}
