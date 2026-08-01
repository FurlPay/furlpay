import type { SwapRecord } from "./swapJournal";

// ---------------------------------------------------------------------------
// Turning journal rows into something a person can read and act on.
//
// The journal stores machine states — PENDING, NOT_FOUND, WAIT_DESTINATION_
// TRANSACTION, REFUNDED. None of those belong on a screen. "NOT_FOUND" in
// particular is actively alarming and means nothing worse than "the bridge's
// indexer hasn't caught up yet", which is a normal first thirty seconds.
//
// So this module is the only place that maps internal → human, and it is a pure
// function of a row so it can be tested without rendering anything.
//
// The distinction that matters most: a REFUNDED bridge is FINISHED and NOT a
// success. The money came back. Showing that as "completed" would be the app
// telling someone they received tokens they do not have.
// ---------------------------------------------------------------------------

export type SwapTone = "pending" | "success" | "warning" | "failure";

export interface SwapPresentation {
  /** One line, sentence case. "Bridging to Base". */
  headline: string;
  /** What the user should do or expect next. Empty when there is nothing to say. */
  detail: string;
  tone: SwapTone;
  /** True while the outcome is still unknown — drives spinners. */
  inFlight: boolean;
  /** True when the user should probably look at an explorer or contact support. */
  needsAttention: boolean;
}

export function presentSwap(swap: SwapRecord): SwapPresentation {
  const bridged = swap.fromChain !== swap.toChain;

  if (swap.status === "failed") {
    // A refund is a completed bridge that returned the funds. It is a failure
    // of the SWAP and emphatically not a loss of the money, and the copy has to
    // carry that difference or it reads as "your funds are gone".
    if (swap.bridgeSubstatus === "REFUNDED") {
      return {
        headline: "Refunded",
        detail: `The bridge couldn't complete, so your ${swap.fromToken} was returned on ${swap.fromChain}.`,
        tone: "warning",
        inFlight: false,
        needsAttention: true,
      };
    }
    return {
      headline: "Didn't go through",
      detail: swap.error ?? "This swap failed.",
      tone: "failure",
      inFlight: false,
      // Only worth flagging if money actually moved. A swap that failed before
      // broadcast needs no investigation — nothing left the wallet.
      needsAttention: Boolean(swap.txHash),
    };
  }

  if (swap.status === "done") {
    return {
      headline: "Completed",
      detail: swap.amountOut
        ? `Received about ${swap.amountOut} ${swap.toToken}.`
        : "",
      tone: "success",
      inFlight: false,
      needsAttention: false,
    };
  }

  if (swap.status === "bridging") {
    return {
      headline: `Bridging to ${swap.toChain}`,
      // Deliberately does NOT surface WAIT_DESTINATION_TRANSACTION or
      // NOT_FOUND. Both mean "not there yet", which is what this says.
      detail: "Your funds have left the source chain and are on their way. This can take a few minutes.",
      tone: "pending",
      inFlight: true,
      needsAttention: false,
    };
  }

  // pending
  if (!swap.txHash) {
    return {
      headline: "Starting",
      detail: "Preparing your swap.",
      tone: "pending",
      inFlight: true,
      needsAttention: false,
    };
  }
  return {
    headline: bridged ? "Sent — waiting to arrive" : "Confirming",
    detail: bridged
      ? "The source transaction is in. Waiting for the destination chain."
      : "Waiting for the network to confirm.",
    tone: "pending",
    inFlight: true,
    needsAttention: false,
  };
}

/** "100 USDC → USDC on Base" — the one-line identity of a swap. */
export function describeSwap(swap: SwapRecord): string {
  const sameChain = swap.fromChain === swap.toChain;
  const pair = `${swap.amountIn} ${swap.fromToken} → ${swap.toToken}`;
  return sameChain ? `${pair} on ${swap.fromChain}` : `${pair} · ${swap.fromChain} → ${swap.toChain}`;
}

export interface TimelineEntry {
  label: string;
  at: number | null;
  /** `done` past, `active` current, `pending` not yet, `failed` stopped here. */
  state: "done" | "active" | "pending" | "failed";
}

/**
 * The status timeline for a detail screen.
 *
 * Only steps that ACTUALLY HAPPEN for this swap appear: a same-chain swap has
 * no bridge leg, and showing a permanently greyed-out "Bridge" row invites the
 * question "is it stuck?" about a step that was never going to run.
 *
 * Timestamps are coarse — the journal keeps `createdAt` and `updatedAt`, not a
 * per-step clock. Rather than invent times, unknown ones are null and the UI
 * omits them.
 */
export function swapTimeline(swap: SwapRecord): TimelineEntry[] {
  const bridged = swap.fromChain !== swap.toChain;
  const failed = swap.status === "failed";
  const entries: TimelineEntry[] = [];

  entries.push({ label: "Swap submitted", at: swap.createdAt, state: "done" });

  if (swap.approvalTxHash) {
    entries.push({ label: `${swap.fromToken} approved`, at: null, state: "done" });
  }

  const broadcast = Boolean(swap.txHash);
  entries.push({
    label: `${swap.fromChain} transaction sent`,
    at: null,
    state: broadcast ? "done" : failed ? "failed" : "pending",
  });

  const confirmed = swap.status === "bridging" || swap.status === "done";
  entries.push({
    label: `Confirmed on ${swap.fromChain}`,
    at: null,
    state: confirmed ? "done" : failed && broadcast ? "failed" : broadcast ? "active" : "pending",
  });

  if (bridged) {
    const arrived = swap.status === "done";
    const refunded = swap.bridgeSubstatus === "REFUNDED";
    entries.push({
      label: refunded ? "Bridge refunded" : `Arrived on ${swap.toChain}`,
      at: arrived ? swap.updatedAt : null,
      state: refunded ? "failed" : arrived ? "done" : failed ? "failed" : confirmed ? "active" : "pending",
    });
  }

  return entries;
}
