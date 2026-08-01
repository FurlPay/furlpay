import { api } from "@/lib/api";
import { toBigInt } from "@/lib/evm/rlp";
import { getTransactionReceipt, type ChainSlug } from "@/lib/evm/rpc";
import { recordSwapEvent } from "./telemetry";
import {
  expireStaleSwaps,
  listResumableSwaps,
  updateSwap,
  type SwapRecord,
} from "./swapJournal";

// ---------------------------------------------------------------------------
// Resuming bridges that outlived the screen that started them.
//
// THE PROBLEM THIS SOLVES. A cross-chain swap has two transactions on two
// chains, minutes apart. `executeSwap` polls for the second one, but only while
// it is running — and a user who starts a bridge and backgrounds the app has
// killed that poller. The funds have left the source chain, the destination
// transfer is in flight, and nothing in the app is watching. On the next launch
// there was previously no record it ever happened.
//
// So: the journal records every swap before it broadcasts, and this resumes any
// entry that is still open. Crucially it re-reads state from LI.FI rather than
// assuming anything — the bridge may have completed, failed, or refunded while
// the app was closed, and all three are indistinguishable from here without
// asking.
//
// This is a RECONCILER, not a poller. It runs once per launch, brings the
// journal in line with the chain, and stops. Live progress for a swap the user
// is actually watching stays with executeSwap.
// ---------------------------------------------------------------------------

interface BridgeStatusResponse {
  status: "NOT_FOUND" | "INVALID" | "PENDING" | "DONE" | "FAILED";
  substatus: string | null;
  substatusMessage: string | null;
  receiving: string | null;
}

export interface ResumeOutcome {
  /** Entries examined. */
  checked: number;
  /** Entries that reached a terminal state during this pass. */
  settled: number;
  /** Entries still in flight — left open for the next launch. */
  stillPending: number;
  /** Entries closed for age rather than by an answer. */
  expired: number;
}

/**
 * Reconciles every open swap against the network. Safe to call on every launch.
 *
 * Never throws: this runs during app start, and a failure to reach LI.FI must
 * not stop the app from opening. An unreachable status endpoint simply leaves
 * the entry open for next time, which is the correct outcome — "we don't know"
 * is not "it failed".
 */
export async function resumeOpenSwaps(): Promise<ResumeOutcome> {
  const outcome: ResumeOutcome = { checked: 0, settled: 0, stillPending: 0, expired: 0 };

  try {
    outcome.expired = expireStaleSwaps();
  } catch {
    // A journal read failure is not a reason to fail app start.
    return outcome;
  }

  let open: SwapRecord[];
  try {
    open = listResumableSwaps();
  } catch {
    return outcome;
  }

  for (const swap of open) {
    outcome.checked++;
    try {
      if (swap.fromChain === swap.toChain) {
        // A same-chain swap has no second leg — its outcome is the receipt.
        // One read, not a poll: this runs at app start and must not block it.
        if (await settleSameChain(swap)) outcome.settled++;
        else outcome.stillPending++;
        continue;
      }

      const status = await api<BridgeStatusResponse>(
        `/swaps/status?txHash=${encodeURIComponent(swap.txHash!)}` +
          `&fromChain=${encodeURIComponent(swap.fromChain)}` +
          `&toChain=${encodeURIComponent(swap.toChain)}`
      );

      if (status.status === "DONE") {
        // DONE is not automatically success: a refund is a completed bridge
        // that returned the funds, and calling that "done" in the UI would be
        // the app telling the user they received something they did not.
        const refunded = status.substatus === "REFUNDED";
        updateSwap(swap.id, {
          status: refunded ? "failed" : "done",
          step: "done",
          destTxHash: status.receiving,
          bridgeStatus: status.status,
          bridgeSubstatus: status.substatus,
          error: refunded
            ? "The bridge couldn't complete and refunded you on the source chain."
            : null,
        });
        recordSwapEvent({
          name: "swap.bridge",
          routeId: swap.routeId,
          fromChain: swap.fromChain,
          toChain: swap.toChain,
          txHash: swap.txHash,
          bridgeStatus: status.status,
          bridgeSubstatus: status.substatus,
          step: "resumed",
        });
        outcome.settled++;
      } else if (status.status === "FAILED" || status.status === "INVALID") {
        updateSwap(swap.id, {
          status: "failed",
          bridgeStatus: status.status,
          bridgeSubstatus: status.substatus,
          error:
            status.substatusMessage ??
            "The bridge didn't complete. Check the explorer for where your funds are.",
        });
        outcome.settled++;
      } else {
        // PENDING, or NOT_FOUND because the indexer has not caught up yet.
        // Both mean "ask again later" — marking either as failed would report a
        // loss that has not happened.
        updateSwap(swap.id, {
          status: "bridging",
          bridgeStatus: status.status,
          bridgeSubstatus: status.substatus,
        });
        outcome.stillPending++;
      }
    } catch {
      // Offline, or the status route is down. Leave the entry open.
      outcome.stillPending++;
    }
  }

  return outcome;
}

/**
 * A same-chain swap found still open on launch. Returns whether it settled.
 *
 * Reads the receipt rather than assuming. "Still open" carries no information
 * about the outcome — the app was simply not watching — and writing `done`
 * without asking would put a success in the user's history that nothing
 * verified. A null receipt means still unmined, which is a real third answer
 * and leaves the entry open for the next launch.
 */
async function settleSameChain(swap: SwapRecord): Promise<boolean> {
  const receipt = await getTransactionReceipt(swap.fromChain as ChainSlug, swap.txHash!);
  if (!receipt) return false;

  const succeeded = toBigInt(receipt.status) === 1n;
  updateSwap(swap.id, {
    status: succeeded ? "done" : "failed",
    step: "done",
    error: succeeded ? null : "The swap was mined but reverted on-chain.",
  });
  return true;
}
