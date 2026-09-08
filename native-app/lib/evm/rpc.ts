import { api, ApiError } from "@/lib/api";
import { toBigInt } from "./rlp";

// ---------------------------------------------------------------------------
// JSON-RPC, through the server.
//
// Every call goes to POST /api/chain/rpc, which holds the node URLs and an
// allowlist of methods. The app deliberately carries NO chain table: RPC
// endpoints are env-configured server-side and the good ones have API keys in
// them, so shipping them in an APK would publish them. It also means a node
// swap is a deploy, not an app-store release.
// ---------------------------------------------------------------------------

/** Chain slugs the proxy accepts — must match CHAIN_REGISTRY ids server-side. */
export type ChainSlug = "ethereum" | "arbitrum" | "base" | "polygon" | "robinhood";

export class RpcError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

async function rpc<T>(chain: ChainSlug, method: string, params: unknown[] = []): Promise<T> {
  try {
    const res = await api<{ result: T }>("/chain/rpc", {
      method: "POST",
      body: { chain, method, params },
    });
    return res.result;
  } catch (e) {
    if (e instanceof ApiError) {
      const data = e.data as { error?: string; detail?: string } | null;
      throw new RpcError(data?.error ?? "rpc_failed", data?.detail ?? e.message);
    }
    throw e;
  }
}

/** Next nonce for this address, counting transactions already in the mempool. */
export async function getTransactionCount(chain: ChainSlug, address: string): Promise<bigint> {
  // "pending", not "latest": two swaps in quick succession would otherwise be
  // handed the same nonce, and the second replaces the first instead of
  // following it.
  return toBigInt(await rpc<string>(chain, "eth_getTransactionCount", [address, "pending"]));
}

export async function getBalance(chain: ChainSlug, address: string): Promise<bigint> {
  return toBigInt(await rpc<string>(chain, "eth_getBalance", [address, "latest"]));
}

export async function call(chain: ChainSlug, to: string, data: string): Promise<string> {
  return rpc<string>(chain, "eth_call", [{ to, data }, "latest"]);
}

/**
 * The deployed bytecode at an address — `"0x"` for an ordinary wallet.
 *
 * The one reliable way to tell a contract from an EOA before treating an
 * address as either. Adding a token is where it matters most: pasting a WALLET
 * address into "add token" otherwise succeeds, reads a zero balance forever,
 * and looks like the app is broken rather than like the user pasted the wrong
 * thing.
 */
export async function getCode(chain: ChainSlug, address: string): Promise<string> {
  return rpc<string>(chain, "eth_getCode", [address, "latest"]);
}

export interface FeeCaps {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/**
 * EIP-1559 fee caps for the next block.
 *
 * `maxFeePerGas = baseFee × 2 + tip` — the doubling absorbs the 12.5% per-block
 * base-fee increase for several blocks, so a transaction signed now is still
 * includable if it sits in the mempool. The user is refunded the difference;
 * the cap is a ceiling, not a price.
 *
 * L2s (Arbitrum, Base) commonly report a zero priority fee, which is correct
 * there and must not be "corrected" upward — that would just overpay.
 */
export async function getFeeCaps(chain: ChainSlug): Promise<FeeCaps> {
  let baseFee = 0n;
  try {
    const history = await rpc<{ baseFeePerGas?: string[] }>(chain, "eth_feeHistory", [
      "0x1",
      "latest",
      [],
    ]);
    const fees = history?.baseFeePerGas ?? [];
    // feeHistory returns one more entry than blocks requested — the last is the
    // NEXT block's base fee, which is the one being priced.
    if (fees.length) baseFee = toBigInt(fees[fees.length - 1]);
  } catch {
    // Older or minimal nodes may not implement it; gasPrice below covers us.
  }

  let tip = 0n;
  try {
    tip = toBigInt(await rpc<string>(chain, "eth_maxPriorityFeePerGas"));
  } catch {
    tip = 0n;
  }

  if (baseFee === 0n) {
    // No EIP-1559 data. eth_gasPrice already includes a tip, so use it as the
    // cap rather than adding one on top.
    const gasPrice = toBigInt(await rpc<string>(chain, "eth_gasPrice"));
    return { maxFeePerGas: gasPrice, maxPriorityFeePerGas: tip > gasPrice ? gasPrice : tip };
  }

  return { maxFeePerGas: baseFee * 2n + tip, maxPriorityFeePerGas: tip };
}

/**
 * Gas estimate for a call, with headroom.
 *
 * The +25% matters: a swap's gas use depends on pool state that can change
 * between estimating and mining, and an out-of-gas revert still charges the
 * user for everything burned before it failed.
 */
export async function estimateGas(
  chain: ChainSlug,
  tx: { from: string; to: string; data: string; value?: string }
): Promise<bigint> {
  const raw = await rpc<string>(chain, "eth_estimateGas", [
    { from: tx.from, to: tx.to, data: tx.data, value: tx.value ?? "0x0" },
  ]);
  return (toBigInt(raw) * 125n) / 100n;
}

/** Broadcasts a signed transaction. Returns its hash. */
export async function sendRawTransaction(chain: ChainSlug, raw: string): Promise<string> {
  return rpc<string>(chain, "eth_sendRawTransaction", [raw]);
}

export interface Receipt {
  transactionHash: string;
  /** "0x1" success, "0x0" reverted. */
  status: string;
  blockNumber: string;
  gasUsed: string;
}

/**
 * One receipt read, no polling.
 *
 * `null` means "not mined yet", which is a genuine third answer alongside
 * success and failure — callers must not collapse it into either.
 */
export async function getTransactionReceipt(
  chain: ChainSlug,
  hash: string
): Promise<Receipt | null> {
  return rpc<Receipt | null>(chain, "eth_getTransactionReceipt", [hash]);
}

/**
 * Polls until the transaction is mined.
 *
 * A null receipt means "not mined yet", NOT "failed" — treating the two alike
 * is how a UI tells someone their swap failed while it is still pending.
 * Timing out is reported as exactly that, with the hash, so the user can follow
 * it in an explorer.
 */
export async function waitForReceipt(
  chain: ChainSlug,
  hash: string,
  {
    timeoutMs = 120_000,
    intervalMs = 3_000,
    /**
     * The sender and the nonce this transaction used. Supplied lets polling
     * detect a REPLACEMENT — a speed-up or cancel issued from another wallet on
     * the same account — instead of waiting out the timeout on a hash that will
     * never mine.
     */
    replacementWatch,
    /**
     * Confirmations required before the result is treated as final.
     *
     * One is right for the L2s this app swaps on, where reorgs past the first
     * block are not a practical concern. Ethereum mainnet callers should raise
     * it: a single confirmation there is a probability, not a fact.
     */
    confirmations = 1,
  }: {
    timeoutMs?: number;
    intervalMs?: number;
    replacementWatch?: { from: string; nonce: bigint };
    confirmations?: number;
  } = {}
): Promise<Receipt> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const receipt = await rpc<Receipt | null>(chain, "eth_getTransactionReceipt", [hash]);
    if (receipt) {
      if (confirmations <= 1) return receipt;
      const head = toBigInt(await rpc<string>(chain, "eth_blockNumber"));
      const mined = toBigInt(receipt.blockNumber);
      if (head - mined + 1n >= BigInt(confirmations)) return receipt;
    } else if (replacementWatch) {
      // No receipt for OUR hash. If the account's nonce has already moved past
      // the one we used, some other transaction took that slot — the user sped
      // it up or cancelled it elsewhere. Waiting longer cannot help.
      const latest = toBigInt(
        await rpc<string>(chain, "eth_getTransactionCount", [replacementWatch.from, "latest"])
      );
      if (latest > replacementWatch.nonce) {
        throw new RpcError(
          "replaced",
          "This transaction was replaced by another one from your wallet. Check your wallet history for the result."
        );
      }
    }

    if (Date.now() >= deadline) {
      throw new RpcError(
        "receipt_timeout",
        "The transaction was submitted but hasn't confirmed yet. It may still land."
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
