import { api } from "@/lib/api";
import { messageFor } from "@/lib/execution";
import { allowance, encodeApprove } from "@/lib/evm/erc20";
import { toBigInt } from "@/lib/evm/rlp";
import {
  estimateGas,
  getBalance,
  getFeeCaps,
  getTransactionCount,
  sendRawTransaction,
  waitForReceipt,
  RpcError,
  type ChainSlug,
} from "@/lib/evm/rpc";
import { fromTransactionRequest, maximumCostWei, type Eip1559Transaction } from "@/lib/evm/transaction";
import { defaultSigner } from "@/lib/signing/registry";
import { supportsChain, type AccountSigner } from "@/lib/signing/types";
import { assertFeesSane, assertFresh, assertPlanSignable, CONFIRMATIONS, parseAtomic } from "./validatePlan";
import { recordSwapEvent, startSwapTimer } from "./telemetry";
import { openSwap, updateSwap } from "./swapJournal";

// ---------------------------------------------------------------------------
// Non-custodial swap execution, end to end.
//
// This is the OTHER swap rail, and the distinction is the whole reason the file
// exists. /api/swaps is the custodial demo ledger: the server issues a
// single-use quoteId and settles it internally. This one — /api/swaps/execute —
// returns Li.Fi's unsigned `transactionRequest`, and the user's own key signs
// and broadcasts it. FurlPay never holds the key and cannot move these funds.
//
// The sequence, and why it is in this order:
//
//   1. Ask the server to build the route. Free, and it can fail for reasons
//      (unroutable pair, amount over the cap) that should never cost a prompt.
//   2. Read the ERC-20 allowance. Also free. Most repeat swaps are already
//      approved, and skipping this would prompt for an approval nobody needs.
//   3. Check the native balance covers value + worst-case gas. Cheaper to
//      refuse here than to let a transaction revert out-of-funds AFTER the user
//      authorised it and paid for the failure.
//   4. Approve, if needed. One biometric, one transaction, WAITED ON — the swap
//      reverts if it front-runs its own approval.
//   5. Swap. Second biometric, second transaction.
//
// Two biometrics for one swap is not an oversight. They authorise two distinct
// on-chain actions, and collapsing them would mean one prompt covering a
// transaction the user has not been shown.
// ---------------------------------------------------------------------------

export type SwapToken = "USDC" | "USDT" | "DAI" | "XSGD" | "XUSD" | "ETH";

/** Re-exported so callers don't reach into lib/evm for a chain slug. */
export type ChainSlugOf = ChainSlug;

export interface SwapQuote {
  fromToken: SwapToken;
  toToken: SwapToken;
  fromChain: ChainSlug;
  toChain: ChainSlug;
  amountIn: number;
  amountOut: number;
  slippagePct: number;
  gasUsd: number;
  feeUsd: number;
  route: string[];
  etaSeconds: number;
  source: "lifi";
}

interface ExecutionPlan {
  quote: SwapQuote;
  /** Contract needing an ERC-20 approval, or null for a native-token swap. */
  approvalAddress: string | null;
  /**
   * The token contract to approve and the exact atomic amount, both as the
   * QUOTE resolved them.
   *
   * The app deliberately holds no token-address map. One would be a second
   * source of truth that goes stale the first time a chain migrates a token,
   * and the failure mode — approving a contract the router will not pull from —
   * looks like a broken app rather than stale data.
   */
  fromTokenAddress: string | null;
  fromAmountAtomic: string | null;
  fromTokenDecimals: number | null;
  /** Floor the router enforces on-chain — a route delivering less reverts. */
  toAmountMin: string | null;
  slippage: number | null;
  routeId: string | null;
  /** Stamped by our server; Li.Fi's /v1/quote carries no expiry of its own. */
  expiresAt: string;
  builtAt: string;
  transactionRequest: {
    to: string;
    data: string;
    value: string;
    chainId: number;
    gasLimit?: string;
  };
}

/** Where the flow is, for the UI. Each step is a real on-chain event. */
export type SwapStep =
  | "building"
  | "checking-allowance"
  | "awaiting-approval-signature"
  | "confirming-approval"
  | "awaiting-swap-signature"
  | "broadcasting"
  | "confirming"
  | "bridging"
  | "done";

export interface SwapProgress {
  step: SwapStep;
  /** Set once the swap transaction is broadcast, so the UI can link an explorer. */
  txHash?: string;
}

export interface SwapResult {
  txHash: string;
  quote: SwapQuote;
  approvalTxHash?: string;
}

/** A failure the user can act on. `txHash` is set when money is already moving. */
export class SwapFailed extends Error {
  readonly step: SwapStep;
  readonly txHash?: string;
  constructor(step: SwapStep, message: string, txHash?: string) {
    super(message);
    this.name = "SwapFailed";
    this.step = step;
    this.txHash = txHash;
  }
}

export interface ExecuteParams {
  fromToken: SwapToken;
  toToken: SwapToken;
  fromChain: ChainSlug;
  toChain?: ChainSlug;
  amountIn: number;
  /**
   * Who signs. Defaults to the on-device key.
   *
   * A Ledger over BLE or a Tangem over NFC is the same interface, so nothing
   * below this line changes when one is passed instead.
   */
  signer?: AccountSigner;
  onProgress?: (progress: SwapProgress) => void;
}

/**
 * Journal writes are best-effort and MUST NOT be able to fail a swap.
 *
 * The journal is a record of what happened, not part of making it happen. A
 * failed INSERT is a lost history row; an exception escaping mid-flow would be
 * a lost transaction. Those are not remotely the same cost.
 */
function journal(write: () => void): void {
  try {
    write();
  } catch {
    /* history is not worth a transaction */
  }
}

export async function executeSwap(params: ExecuteParams): Promise<SwapResult> {
  // Carries the journal id out of runSwap so the failure handler can close the
  // entry it opened. Without it a failed swap stays "pending" forever and gets
  // retried by the resumer on every launch.
  const ref: { swapId?: string } = {};
  try {
    return await runSwap(params, ref);
  } catch (e) {
    // One place records every failure, so a new throw site cannot ship without
    // telemetry. `reason` is the machine-readable step; the message stays the
    // user's, and neither is a substitute for the other in a support ticket.
    if (e instanceof SwapFailed) {
      recordSwapEvent({
        name: "swap.failed",
        step: e.step,
        reason: e.step,
        txHash: e.txHash ?? null,
        fromChain: params.fromChain,
        toChain: params.toChain ?? params.fromChain,
        fromToken: params.fromToken,
        toToken: params.toToken,
      });
      if (ref.swapId) {
        const id = ref.swapId;
        journal(() =>
          updateSwap(id, {
            // A failure PAST broadcast keeps its hash: the transaction exists
            // and the user needs to be able to find it whatever we say here.
            status: "failed",
            step: e.step,
            error: e.message,
            ...(e.txHash ? { txHash: e.txHash } : {}),
          })
        );
      }
    }
    throw e;
  }
}

async function runSwap(params: ExecuteParams, ref: { swapId?: string }): Promise<SwapResult> {
  const report = (step: SwapStep, txHash?: string) => params.onProgress?.({ step, txHash });
  const elapsed = startSwapTimer();

  const signer = params.signer ?? defaultSigner();
  const from = await signer.getAddress();
  if (!from) {
    // The remedy differs by signer and the message has to say which: "create a
    // wallet" is useless advice to someone whose Ledger is simply asleep.
    throw new SwapFailed(
      "building",
      signer.kind === "device-key"
        ? "No wallet on this device. Create or import one first."
        : `Couldn't read an account from ${signer.label}. Make sure it's connected and unlocked.`
    );
  }

  // A hardware signer is limited by its firmware; a software key is not.
  // Checked before the route is built so an unsupported chain costs nothing.
  if (!supportsChain(signer, CHAIN_IDS[params.fromChain])) {
    throw new SwapFailed("building", `${signer.label} cannot sign for ${params.fromChain}.`);
  }

  // 1. Build the route server-side.
  report("building");
  let plan: ExecutionPlan;
  try {
    const res = await api<{ ok: true } & ExecutionPlan>("/swaps/execute", {
      method: "POST",
      body: {
        fromToken: params.fromToken,
        toToken: params.toToken,
        fromChain: params.fromChain,
        toChain: params.toChain,
        amountIn: params.amountIn,
        fromAddress: from,
      },
    });
    plan = res;
  } catch (e) {
    throw new SwapFailed("building", messageFor(e));
  }

  // Validated on the device, against the chain the USER picked — not the one
  // the response claims. Everything below this line is about to be signed by a
  // key the server does not hold, so the server's own validation is not the
  // last word on it.
  try {
    assertPlanSignable(plan, params.fromChain, Date.now());
  } catch (e) {
    throw new SwapFailed("building", (e as Error).message);
  }

  const chain = params.fromChain;
  let approvalTxHash: string | undefined;

  /** Every event carries the route id — the field a support ticket starts from. */
  const trace = {
    routeId: plan.routeId,
    fromChain: plan.quote.fromChain,
    toChain: plan.quote.toChain,
    fromToken: plan.quote.fromToken,
    toToken: plan.quote.toToken,
  };
  recordSwapEvent({ name: "swap.quote", ...trace, elapsedMs: elapsed() });

  // Journal opened BEFORE anything is broadcast. An entry written only on
  // success cannot describe the case that matters — the app dying mid-bridge.
  const swapId = plan.routeId ?? `swap-${Date.now()}`;
  ref.swapId = swapId;
  journal(() =>
    openSwap({
      id: swapId,
      routeId: plan.routeId,
      fromChain: plan.quote.fromChain,
      toChain: plan.quote.toChain,
      fromToken: plan.quote.fromToken,
      toToken: plan.quote.toToken,
      amountIn: plan.quote.amountIn,
    })
  );

  // 2 + 4. Allowance, then approval only if it is actually short.
  //
  // All three fields come from the route. A native-token sell reports
  // approvalAddress null and there is nothing to approve; an ERC-20 sell that
  // somehow arrived without a token address is a broken route, and proceeding
  // would submit a swap destined to revert on transferFrom.
  if (plan.approvalAddress) {
    if (!plan.fromTokenAddress || !plan.fromAmountAtomic) {
      throw new SwapFailed(
        "checking-allowance",
        "This route needs a token approval but didn't say which token. Nothing was sent."
      );
    }
    const required = parseAtomic(plan.fromAmountAtomic);
    if (required === null || required === 0n) {
      throw new SwapFailed("checking-allowance", "The route quoted an unusable approval amount.");
    }

    report("checking-allowance");
    let current: bigint;
    try {
      current = await allowance(chain, plan.fromTokenAddress, from, plan.approvalAddress);
    } catch (e) {
      throw new SwapFailed("checking-allowance", describeRpc(e));
    }

    if (current < required) {
      approvalTxHash = await sendApproval({
        chain,
        from,
        token: plan.fromTokenAddress,
        spender: plan.approvalAddress,
        amount: required,
        signer,
        report,
      });
    }
  }

  // 3 + 5. Price the swap, check funds, sign, broadcast.
  let tx: Eip1559Transaction;
  try {
    const [nonce, fees] = await Promise.all([getTransactionCount(chain, from), getFeeCaps(chain)]);
    const fallbackGasLimit = plan.transactionRequest.gasLimit
      ? 0n
      : await estimateGas(chain, {
          from,
          to: plan.transactionRequest.to,
          data: plan.transactionRequest.data,
          value: plan.transactionRequest.value,
        });
    tx = fromTransactionRequest(plan.transactionRequest, {
      nonce,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      fallbackGasLimit,
    });

    assertFeesSane(tx);

    const balance = await getBalance(chain, from);
    const needed = maximumCostWei(tx);
    if (balance < needed) {
      // Refused BEFORE the biometric. Asking someone to authorise a transaction
      // that cannot succeed wastes their gas and their trust.
      throw new SwapFailed(
        "awaiting-swap-signature",
        "Not enough balance to cover this swap and its network fee."
      );
    }
  } catch (e) {
    if (e instanceof SwapFailed) throw e;
    throw new SwapFailed("awaiting-swap-signature", describeRpc(e));
  }

  // Re-checked immediately before the prompt. The approval above can take a
  // minute or two to mine, and a plan that was fresh when the flow started can
  // be stale by the time the user is asked to sign the swap itself.
  try {
    assertFresh(plan, Date.now());
  } catch (e) {
    throw new SwapFailed("awaiting-swap-signature", (e as Error).message);
  }

  report("awaiting-swap-signature");
  let signed: { raw: string; hash: string };
  try {
    signed = await signer.signTransaction(tx);
  } catch (e) {
    // A declined biometric lands here. Nothing has been broadcast.
    throw new SwapFailed("awaiting-swap-signature", messageFor(e));
  }

  report("broadcasting");
  let txHash: string;
  try {
    txHash = await sendRawTransaction(chain, signed.raw);
  } catch (e) {
    throw new SwapFailed("broadcasting", describeRpc(e));
  }

  // The node returns the hash it computed. It must equal the one we computed
  // from the bytes we signed — if it does not, we are about to poll for a
  // transaction that is not ours, and report someone else's outcome as the
  // user's. Cheap check, and the failure it catches is otherwise invisible.
  if (txHash.toLowerCase() !== signed.hash.toLowerCase()) {
    throw new SwapFailed(
      "broadcasting",
      "The network acknowledged a different transaction than the one signed. Check your wallet before retrying.",
      txHash
    );
  }

  // Past this point the transaction is public and may land whatever happens
  // here, so every failure below carries the hash.
  recordSwapEvent({ name: "swap.broadcast", ...trace, txHash, approvalTxHash, elapsedMs: elapsed() });
  // The hash is what makes the entry resumable — without it a later launch has
  // nothing to ask the network about.
  journal(() => updateSwap(swapId, { txHash, approvalTxHash: approvalTxHash ?? null, step: "confirming" }));

  report("confirming", txHash);
  try {
    const receipt = await waitForReceipt(chain, txHash, {
      replacementWatch: { from, nonce: tx.nonce },
      // Per chain: one confirmation is settled on a rollup and a coin-flip on L1.
      confirmations: CONFIRMATIONS[chain] ?? 1,
    });
    if (toBigInt(receipt.status) !== 1n) {
      throw new SwapFailed("confirming", "The swap was mined but reverted on-chain.", txHash);
    }
  } catch (e) {
    if (e instanceof SwapFailed) throw e;
    throw new SwapFailed("confirming", describeRpc(e), txHash);
  }

  // A source-chain receipt settles a SAME-chain swap and nothing more. On a
  // bridged route the destination transfer is a separate transaction on a
  // different chain, and calling this "done" now would tell the user their
  // funds arrived while they are still in flight — or that they arrived when
  // the bridge in fact refunded them.
  const bridged = plan.quote.toChain !== plan.quote.fromChain;
  if (bridged) {
    journal(() => updateSwap(swapId, { status: "bridging", step: "bridging" }));
    report("bridging", txHash);
    try {
      const outcome = await waitForBridge(txHash, plan.quote.fromChain, plan.quote.toChain);
      recordSwapEvent({
        name: "swap.bridge",
        ...trace,
        txHash,
        bridgeStatus: outcome.status,
        bridgeSubstatus: outcome.substatus,
        elapsedMs: elapsed(),
      });
      if (outcome.status !== "DONE") {
        throw new SwapFailed("bridging", bridgeMessage(outcome), txHash);
      }
      if (outcome.substatus === "REFUNDED") {
        throw new SwapFailed(
          "bridging",
          "The bridge couldn't complete and refunded you on the source chain.",
          txHash
        );
      }
    } catch (e) {
      if (e instanceof SwapFailed) throw e;
      throw new SwapFailed("bridging", describeRpc(e), txHash);
    }
  }

  journal(() => updateSwap(swapId, { status: "done", step: "done", amountOut: plan.quote.amountOut }));
  recordSwapEvent({ name: "swap.confirmed", ...trace, txHash, approvalTxHash, elapsedMs: elapsed() });
  report("done", txHash);
  return { txHash, quote: plan.quote, approvalTxHash };
}

// --- bridge lifecycle -------------------------------------------------------

interface BridgeStatus {
  status: "NOT_FOUND" | "INVALID" | "PENDING" | "DONE" | "FAILED";
  substatus: string | null;
  substatusMessage: string | null;
  receiving: string | null;
}

/**
 * Polls LI.FI's /v1/status until the destination transfer resolves.
 *
 * NOT_FOUND is expected for the first few polls — the indexer has to see the
 * source transaction first — so it is treated as "keep waiting", not as a
 * failure. A timeout here does not mean the funds are lost: bridges can take
 * far longer than any UI should block for, which is why the message says to
 * follow it in the explorer rather than implying the transfer died.
 */
async function waitForBridge(
  txHash: string,
  fromChain: string,
  toChain: string,
  { timeoutMs = 15 * 60_000, intervalMs = 6_000 } = {}
): Promise<BridgeStatus> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await api<BridgeStatus>(
      `/swaps/status?txHash=${encodeURIComponent(txHash)}` +
        `&fromChain=${encodeURIComponent(fromChain)}&toChain=${encodeURIComponent(toChain)}`
    );
    if (status.status === "DONE" || status.status === "FAILED") return status;
    if (Date.now() >= deadline) {
      throw new SwapFailed(
        "bridging",
        "The swap left the source chain but hasn't arrived yet. Bridges can take a while — follow it in the explorer.",
        txHash
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function bridgeMessage(outcome: BridgeStatus): string {
  if (outcome.substatusMessage) return outcome.substatusMessage;
  switch (outcome.substatus) {
    case "BRIDGE_NOT_AVAILABLE":
    case "CHAIN_NOT_AVAILABLE":
      return "The bridge was unavailable. Your funds are on the source chain.";
    case "REFUND_IN_PROGRESS":
      return "The bridge is refunding you on the source chain.";
    default:
      return "The bridge didn't complete. Check the explorer for where your funds are.";
  }
}

async function sendApproval(args: {
  chain: ChainSlug;
  from: string;
  token: string;
  spender: string;
  amount: bigint;
  signer: AccountSigner;
  report: (step: SwapStep, txHash?: string) => void;
}): Promise<string> {
  const { chain, from, token, spender, amount, signer, report } = args;
  const data = encodeApprove(spender, amount);

  let tx: Eip1559Transaction;
  try {
    const [nonce, fees, gasLimit] = await Promise.all([
      getTransactionCount(chain, from),
      getFeeCaps(chain),
      estimateGas(chain, { from, to: token, data }),
    ]);
    tx = {
      chainId: 0, // replaced below — the route's chainId is authoritative
      nonce,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      gasLimit,
      to: token,
      value: 0n,
      data,
    };
  } catch (e) {
    throw new SwapFailed("awaiting-approval-signature", describeRpc(e));
  }

  // chainId comes from the same source that built the route, so an approval can
  // never be signed for a different network than the swap it enables.
  tx.chainId = CHAIN_IDS[chain];
  if (!tx.chainId) {
    throw new SwapFailed("awaiting-approval-signature", `Unsupported chain: ${chain}`);
  }

  report("awaiting-approval-signature");
  let signed: { raw: string; hash: string };
  try {
    signed = await signer.signTransaction(tx);
  } catch (e) {
    throw new SwapFailed("awaiting-approval-signature", messageFor(e));
  }

  let hash: string;
  try {
    hash = await sendRawTransaction(chain, signed.raw);
  } catch (e) {
    throw new SwapFailed("awaiting-approval-signature", describeRpc(e));
  }

  // WAITED ON, not fired and forgotten. A swap broadcast before its approval is
  // mined reverts, and the user pays for the revert.
  report("confirming-approval", hash);
  try {
    const receipt = await waitForReceipt(chain, hash);
    if (toBigInt(receipt.status) !== 1n) {
      throw new SwapFailed("confirming-approval", "The approval reverted on-chain.", hash);
    }
  } catch (e) {
    if (e instanceof SwapFailed) throw e;
    throw new SwapFailed("confirming-approval", describeRpc(e), hash);
  }
  return hash;
}

/**
 * chainId per slug, matching CHAIN_REGISTRY server-side.
 *
 * Present only because an approval is built entirely client-side — the swap's
 * chainId comes from the route. Kept adjacent to the one place that needs it
 * rather than becoming a general chain table.
 */
const CHAIN_IDS: Record<ChainSlug, number> = {
  ethereum: 1,
  arbitrum: 42161,
  base: 8453,
  polygon: 137,
  robinhood: 4663,
};

function describeRpc(e: unknown): string {
  if (e instanceof RpcError) {
    if (e.code === "receipt_timeout") return e.message;
    if (e.code === "upstream_timeout" || e.code === "upstream_unreachable") {
      return "Couldn't reach the network right now. Nothing was sent.";
    }
    return e.message;
  }
  return messageFor(e);
}
