import { addressForSigning, signMessage, signTransaction, signTypedData } from "@/lib/wallet";
import { getFeeCaps, getTransactionCount, sendRawTransaction, type ChainSlug } from "@/lib/evm/rpc";
import { captureException } from "@/lib/observability";
import { flagEnabled } from "@/lib/flags";
import { queryClient } from "@/lib/queries";
import { CONTACTS_KEY } from "@/lib/contacts/useContacts";
import type { Contact } from "@/lib/contacts/model";
import type { ScanResult } from "@/lib/txscan";
import { RISK_ORDER } from "@/lib/txscan/types";
import type { Eip1559Transaction } from "@/lib/evm/transaction";
import { WalletConnectEngine } from "./engine";
import { chainSlugFromCaip, SUPPORTED_EVM_CHAINS } from "./policy";
import type { RequestIntent } from "./requests";
import { loadWalletKitTransport } from "./transport";

// ---------------------------------------------------------------------------
// The single WalletConnect engine for the process, and the wiring that turns a
// decoded request into a real signature.
//
// A SINGLETON, because the relay connection is one socket and the pending-
// request slot is one slot. Two engines would each hold a socket, each receive
// the same request, and each present a confirmation sheet — and the user would
// approve one while the other still waited.
//
// LAZY, because starting it costs a socket and a keychain read, and most
// sessions never open a dApp. `ensureWalletConnect()` is called by the screens
// that need it, not at app launch.
//
// UNAVAILABLE IS A FIRST-CLASS STATE. The SDK may not be installed in this
// build (see ./transport.ts and ./README.md) and the feature flag may be off.
// Both return null here rather than throwing, and the screens render "not
// available in this build" — which is true, and better than a crash or a
// spinner that never resolves.
// ---------------------------------------------------------------------------

let engine: WalletConnectEngine | null = null;
let starting: Promise<WalletConnectEngine | null> | null = null;

export type WalletConnectUnavailableReason = "flag_off" | "no_sdk";

let lastUnavailableReason: WalletConnectUnavailableReason | null = null;

export function walletConnectUnavailableReason(): WalletConnectUnavailableReason | null {
  return lastUnavailableReason;
}

/**
 * Get the engine, starting it if needed. Null when WalletConnect cannot run.
 *
 * Single-flight: two screens mounting at once must not race two `init()` calls
 * into the SDK, which would open two sockets and register two handler sets.
 */
export async function ensureWalletConnect(): Promise<WalletConnectEngine | null> {
  if (engine) return engine;
  if (starting) return starting;

  starting = (async () => {
    if (!flagEnabled("wallet_connect")) {
      lastUnavailableReason = "flag_off";
      return null;
    }
    const transport = await loadWalletKitTransport();
    if (!transport) {
      lastUnavailableReason = "no_sdk";
      return null;
    }

    const created = new WalletConnectEngine({
      transport,
      getAddress: addressForSigning,
      signAndSend,
      knownAddresses,
    });

    try {
      await created.start();
    } catch (e) {
      // A relay that will not come up is not a reason to leave a half-started
      // engine in the singleton — the next call would return an object whose
      // transport never initialised and whose requests never arrive.
      captureException(e, { scope: "wc.start" });
      starting = null;
      throw e;
    }

    engine = created;
    lastUnavailableReason = null;
    return created;
  })();

  try {
    return await starting;
  } finally {
    starting = null;
  }
}

/** Tear down on sign-out. Relay first, then local rows — see the engine. */
export async function shutdownWalletConnect(): Promise<void> {
  if (!engine) return;
  try {
    await engine.disconnectAllForSignOut();
    await engine.stop();
  } catch (e) {
    captureException(e, { scope: "wc.shutdown" });
  } finally {
    engine = null;
  }
}

export function currentEngine(): WalletConnectEngine | null {
  return engine;
}

/**
 * Addresses the scanner may describe by name instead of by hex.
 *
 * READ SYNCHRONOUSLY FROM THE QUERY CACHE, not by fetching. The address book
 * lives on the server, and awaiting it here would mean the confirmation sheet
 * either blocks on a network call before it can render, or renders once with
 * hex and again with names a moment later. A confirmation screen whose
 * counterparty changes after it appears is a confirmation screen nobody should
 * trust, so the cache is read as-is and an empty cache simply means addresses
 * are shown as addresses — which is the honest fallback, never a wrong name.
 */
function knownAddresses(): Record<string, string> {
  try {
    const snapshot = queryClient.getQueryData<{ contacts: Contact[] }>(CONTACTS_KEY);
    const out: Record<string, string> = {};
    for (const contact of snapshot?.contacts ?? []) {
      for (const addr of contact.addresses ?? []) {
        if (addr.address) out[addr.address.toLowerCase()] = contact.name;
      }
    }
    return out;
  } catch (e) {
    captureException(e, { scope: "wc.knownAddresses" });
    return {};
  }
}

/**
 * The risk level above which this wallet refuses outright.
 *
 * DELIBERATELY NOT "danger". A `danger` verdict requires an explicit
 * acknowledgement in the UI, and that is where the decision belongs: it is the
 * user's key and their money, and a wallet that silently refuses a transaction
 * its heuristics dislike is a wallet that will one day refuse a legitimate one
 * with no way through. What the engine enforces is that the acknowledgement
 * actually happened — `approveRequest` is only reachable from a sheet that
 * showed the findings.
 *
 * The one exception is a scan the UI never saw, which is checked below.
 */
async function signAndSend(
  intent: RequestIntent,
  context: { origin: string; scan: ScanResult },
): Promise<unknown> {
  // Defence in depth against a caller that skipped the sheet. The UI is what
  // collects consent; this asserts that a scan result exists at all, so a code
  // path added later cannot reach the key with nothing rendered.
  if (!context.scan || RISK_ORDER[context.scan.level] === undefined) {
    throw new Error("This request was not checked, so FurlPay will not sign it.");
  }

  switch (intent.kind) {
    case "personal_sign": {
      // signMessage applies the EIP-191 prefix. The decoded hex is converted
      // back to text only when it decoded cleanly; binary messages are signed
      // as their exact bytes rather than a lossy string.
      return signMessage(intent.messageText ?? hexToBinaryString(intent.messageHex));
    }

    case "typed_data": {
      return signTypedData({
        domain: intent.domain,
        types: intent.types as Record<string, Array<{ name: string; type: string }>>,
        primaryType: intent.primaryType,
        message: intent.message,
      });
    }

    case "switch_chain": {
      // Nothing to sign. Returning null is the spec's success value for
      // wallet_switchEthereumChain, and the session event that tells the dApp
      // the chain actually changed is emitted by the caller.
      if (!(intent.chainId in SUPPORTED_EVM_CHAINS)) {
        throw new Error("FurlPay does not support that network.");
      }
      return null;
    }

    case "transaction": {
      const slug = chainSlugFromCaip(`eip155:${intent.chainId}`);
      if (!slug) throw new Error("FurlPay does not support that network.");

      const tx = await buildTransaction(intent, slug);
      const signed = await signTransaction(tx);

      // The address that signed must be the address the dApp asked for. A
      // mismatch means the wallet changed under the request — sending it anyway
      // would move funds from an account the dApp never named.
      if (signed.from.toLowerCase() !== intent.from.toLowerCase()) {
        throw new Error("This request is for a different account than the one on this device.");
      }

      if (!intent.broadcast) return signed.raw;

      await sendRawTransaction(slug, signed.raw);
      // The HASH, not the receipt. eth_sendTransaction returns immediately with
      // the hash; waiting for a receipt here would hold the dApp's RPC call open
      // for the length of a block, and many dApps time out well before that.
      return signed.hash;
    }
  }
}

/**
 * Fill in whatever the dApp left out.
 *
 * DAPP-SUPPLIED VALUES WIN where they were supplied. A dApp that computed a
 * gas limit did so knowing its own contract, and overriding it with our
 * estimate breaks calls whose gas depends on state we cannot see. What we
 * supply is only what was absent.
 *
 * THE NONCE IS ALWAYS OURS UNLESS THE DAPP PINNED ONE. Two transactions racing
 * on the same nonce means the second replaces the first, and a user who
 * approved two transfers sees one arrive.
 */
async function buildTransaction(intent: RequestIntent & { kind: "transaction" }, slug: ChainSlug): Promise<Eip1559Transaction> {
  const [nonce, fees] = await Promise.all([
    intent.nonce !== undefined ? Promise.resolve(intent.nonce) : getTransactionCount(slug, intent.from),
    intent.maxFeePerGas !== undefined && intent.maxPriorityFeePerGas !== undefined
      ? Promise.resolve(null)
      : getFeeCaps(slug),
  ]);

  return {
    chainId: intent.chainId,
    nonce,
    maxFeePerGas: intent.maxFeePerGas ?? fees!.maxFeePerGas,
    maxPriorityFeePerGas: intent.maxPriorityFeePerGas ?? fees!.maxPriorityFeePerGas,
    // A dApp that sent no gas limit gets a conservative default rather than an
    // estimate: eth_estimateGas on a transaction the user has already approved
    // is a second round trip whose failure would surface as "signing failed"
    // long after they tapped confirm. 21000 covers a plain transfer; anything
    // with calldata carries its own limit in practice, and one that does not
    // fails on-chain visibly rather than being silently under-funded here.
    gasLimit: intent.gasLimit ?? (intent.data === "0x" ? 21_000n : 250_000n),
    to: intent.to,
    value: intent.value,
    data: intent.data,
  };
}

/** Hex -> a byte-exact latin1 string, for signing binary messages verbatim. */
function hexToBinaryString(hex: string): string {
  const body = hex.replace(/^0x/, "");
  let out = "";
  for (let i = 0; i < body.length; i += 2) out += String.fromCharCode(parseInt(body.slice(i, i + 2), 16));
  return out;
}
