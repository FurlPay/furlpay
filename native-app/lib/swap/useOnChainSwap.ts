import { useCallback, useRef, useState } from "react";
import type { ExecutionStage } from "@/lib/execution";
import { useInvalidateAfterMoneyMove } from "@/lib/queries";
import { hasWallet } from "@/lib/wallet";
import {
  executeSwap,
  SwapFailed,
  type ChainSlugOf,
  type SwapProgress,
  type SwapResult,
  type SwapStep,
  type SwapToken,
} from "./executeSwap";

// ---------------------------------------------------------------------------
// The self-custody swap rail, as a hook.
//
// TWO RAILS, AND THE DIFFERENCE IS NOT COSMETIC:
//
//   /api/swaps { execute: true }   custodial demo ledger. Settles internally
//                                  against a server-issued quoteId, and REFUSES
//                                  IN PRODUCTION (503) rather than record a
//                                  fabricated settlement.
//   /api/swaps/execute             this one. Returns Li.Fi's unsigned
//                                  transactionRequest; the device signs with a
//                                  key FurlPay does not hold, and the
//                                  transaction lands on a real chain.
//
// So on a production build this is the rail that actually moves value, and it
// only exists when the device has a wallet. `available` reflects exactly that —
// there is no fallback to the custodial path, because a swap that silently
// settled on a demo ledger while the user believed they were trading on-chain
// is the worst outcome available here.
// ---------------------------------------------------------------------------

/** Maps the on-chain steps onto the timeline vocabulary the UI already speaks. */
function stageFor(step: SwapStep): ExecutionStage {
  switch (step) {
    case "building":
    case "checking-allowance":
      return "idle";
    case "awaiting-approval-signature":
    case "awaiting-swap-signature":
      return "authorizing";
    case "confirming-approval":
    case "broadcasting":
      return "submitting";
    case "confirming":
    case "bridging":
      // Broadcast and waiting. Still "submitting" to the user — on a bridged
      // route nothing has arrived until the DESTINATION transfer lands, which
      // the source-chain receipt says nothing about.
      return "submitting";
    case "done":
      return "settled";
  }
}

/** Human-readable detail under the timeline. The steps are real chain events. */
const STEP_LABEL: Record<SwapStep, string> = {
  building: "Finding the best route…",
  "checking-allowance": "Checking token approval…",
  "awaiting-approval-signature": "Approve the token to continue",
  "confirming-approval": "Waiting for the approval to confirm…",
  "awaiting-swap-signature": "Confirm the swap",
  broadcasting: "Sending to the network…",
  confirming: "Waiting for confirmation…",
  // Said explicitly, because this is the phase users most often misread as
  // finished: the money has left, and has not arrived.
  bridging: "Bridging to the destination chain…",
  done: "Settled on-chain",
};

export interface UseOnChainSwap {
  /** False when this device holds no wallet — the rail is simply not usable. */
  available: boolean;
  stage: ExecutionStage;
  step: SwapStep | null;
  label: string | null;
  /** Set once broadcast, so the UI can offer an explorer link even on failure. */
  txHash: string | null;
  approvalTxHash: string | null;
  result: SwapResult | null;
  error: string | null;
  executing: boolean;
  execute: (params: {
    fromToken: SwapToken;
    toToken: SwapToken;
    fromChain: ChainSlugOf;
    toChain?: ChainSlugOf;
    amountIn: number;
  }) => Promise<void>;
  reset: () => void;
}

export function useOnChainSwap(): UseOnChainSwap {
  const refetchBalances = useInvalidateAfterMoneyMove();
  const [available, setAvailable] = useState(false);
  const [step, setStep] = useState<SwapStep | null>(null);
  const [stage, setStage] = useState<ExecutionStage>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [approvalTxHash, setApprovalTxHash] = useState<string | null>(null);
  const [result, setResult] = useState<SwapResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A swap involves up to two signatures and two confirmations. The swipe
  // control springs back on interrupt, and a second confirm arriving mid-flight
  // must not start a second swap against the same balance.
  const inFlight = useRef(false);

  // Checked once, un-gated (reads a plain marker, never prompts).
  useState(() => {
    void hasWallet().then(setAvailable);
  });

  const reset = useCallback(() => {
    setStep(null);
    setStage("idle");
    setTxHash(null);
    setApprovalTxHash(null);
    setResult(null);
    setError(null);
  }, []);

  const execute = useCallback<UseOnChainSwap["execute"]>(
    async (params) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setError(null);
      setResult(null);

      try {
        const swap = await executeSwap({
          ...params,
          onProgress: (progress: SwapProgress) => {
            setStep(progress.step);
            setStage(stageFor(progress.step));
            if (progress.txHash) setTxHash(progress.txHash);
          },
        });
        setResult(swap);
        setApprovalTxHash(swap.approvalTxHash ?? null);
        setTxHash(swap.txHash);
        setStage("settled");
        // Balances moved on-chain; the cached ones are now wrong.
        refetchBalances();
      } catch (e) {
        setStage("failed");
        if (e instanceof SwapFailed) {
          setError(e.message);
          setStep(e.step);
          // Carries the hash when the transaction is already public — the user
          // needs it whatever we say next.
          if (e.txHash) setTxHash(e.txHash);
        } else {
          setError((e as Error)?.message ?? "The swap didn't go through.");
        }
      } finally {
        inFlight.current = false;
      }
    },
    [refetchBalances]
  );

  return {
    available,
    stage,
    step,
    label: step ? STEP_LABEL[step] : null,
    txHash,
    approvalTxHash,
    result,
    error,
    executing: inFlight.current && stage !== "settled" && stage !== "failed",
    execute,
    reset,
  };
}
