import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Haptics from "expo-haptics";
import { AbortedError, api, ApiError, TimeoutError } from "@/lib/api";
import { authorizeMoneyMove } from "@/lib/money/authorize";
import { transition, type TxState } from "@/lib/money/transactionState";
import {
  createTransaction,
  getTransaction,
  markUnknownOutcome,
  updateTransactionState,
} from "@/lib/money/transactionStore";
import { correlationOf, messageFor, type ExecutionStage } from "@/lib/execution";
import { parseUsdcAmount, tryParseUsdcAmount } from "@/lib/money";
import { useInvalidateAfterMoneyMove, useOverview } from "@/lib/queries";
import {
  assetBySymbol,
  routability,
  swapWarnings,
  type ChainId,
  type SwapAsset,
  type SwapWarning,
} from "@/lib/swap/assets";

// ---------------------------------------------------------------------------
// Swap state, extracted from the screen so the rules are testable without
// mounting a component — and so the presentation layer cannot quietly change
// one of them.
//
// Every safety property the previous screen had is preserved here verbatim:
//   * amounts parse to atomic units, never through Number()
//   * every quote request owns an AbortController, so a slow earlier response
//     can never repaint over a newer price
//   * execution authorizes a server-issued quoteId, never re-quotable params
//   * a stale quote is RE-PRICED and shown, never executed
//   * slippage above MAX_SLIPPAGE_PCT is refused client-side regardless of what
//     the server said
// ---------------------------------------------------------------------------

/** Mirrors the server's own TTL (apps/web/src/lib/services/swapQuote.ts). */
export const QUOTE_TTL_MS = 30_000;
export const MAX_SLIPPAGE_PCT = 5;
export const WARN_SLIPPAGE_PCT = 1;
export const AMOUNT_MAX_LENGTH = 20;

/** Debounce on live quoting. The server budgets 60 quotes/min/user. */
const QUOTE_DEBOUNCE_MS = 450;

/**
 * Consecutive auto-refreshes before the screen stops re-pricing on its own.
 *
 * A quote auto-refreshes so the number on screen is never one the server would
 * reject. But a screen left open on a desk must not poll a rate-limited,
 * outbound-billed endpoint forever — after this many untouched refreshes the
 * countdown parks at "expired" and waits for the user. Any interaction resets
 * the budget.
 */
const MAX_IDLE_REFRESHES = 5;

export interface SwapQuote {
  fromToken: string;
  toToken: string;
  fromChain: string;
  toChain: string;
  amountIn: number;
  amountOut: number;
  slippagePct: number;
  gasUsd: number;
  feeUsd: number;
  route: string[];
  etaSeconds: number;
  source: "lifi" | "mock";
}

interface QuoteResponse {
  quote: SwapQuote;
  quoteId: string;
  expiresAt: string;
}

export interface SwapPair {
  fromToken: string;
  toToken: string;
  fromChain: ChainId;
  toChain: ChainId;
}

// ── useTokenBalances ───────────────────────────────────────────────────────

export interface HeldBalance {
  token: string;
  chain: ChainId;
  amount: number;
  usdValue: number;
}

/**
 * Spendable balances, keyed by token+chain.
 *
 * Reads the same cached /overview the home tab uses rather than adding a
 * request: the swap screen is usually reached from a screen that already has
 * it, and an offline-first snapshot beats a spinner where the only use is
 * showing a Max button.
 */
export function useTokenBalances() {
  const { data, isLoading, refetch } = useOverview();

  const balances = useMemo<HeldBalance[]>(
    () => (data?.data.tokenBalances ?? []) as HeldBalance[],
    [data]
  );

  const balanceOf = useCallback(
    (token: string, chain: ChainId): HeldBalance | undefined =>
      balances.find((b) => b.token === token && b.chain === chain),
    [balances]
  );

  return {
    balances,
    balanceOf,
    isLoading,
    refetch,
    /** True only when a real snapshot exists — distinguishes "0" from "unknown". */
    known: data !== undefined,
    fromCache: data?.fromCache ?? false,
  };
}

// ── useRouting ─────────────────────────────────────────────────────────────

/**
 * Whether this pair can be priced at all, decided before any request is sent.
 *
 * The server is still the authority, but a user should learn a route is
 * unavailable from a disabled control — not from a failed request after they
 * have already typed an amount.
 */
export function useRouting(pair: SwapPair) {
  return useMemo(() => {
    const fromAsset = assetBySymbol(pair.fromToken);
    const toAsset = assetBySymbol(pair.toToken);
    const route = routability(pair.fromChain, pair.toChain, pair.fromToken, pair.toToken);
    return {
      ...route,
      fromAsset,
      toAsset,
      crossChain: pair.fromChain !== pair.toChain,
    };
  }, [pair.fromChain, pair.fromToken, pair.toChain, pair.toToken]);
}

// ── useSwapValidation ──────────────────────────────────────────────────────

export interface SwapValidation {
  /** Atomic units, or null when the amount is not a valid money string. */
  atomic: bigint | null;
  amountIn: number;
  amountError: string | null;
  /** Blocks quoting entirely. */
  canQuote: boolean;
  /** Why quoting is blocked, written for a user. */
  blockedReason: string | null;
  insufficientBalance: boolean;
}

export function useSwapValidation(
  amount: string,
  pair: SwapPair,
  balance?: HeldBalance
): SwapValidation {
  // Never Number(): "0.0000001" passes `Number(x) > 0` and then truncates to
  // zero atomic units, which is how a zero-value swap gets biometric approval.
  const atomic = useMemo(() => tryParseUsdcAmount(amount), [amount]);
  const amountIn = atomic === null ? 0 : Number(atomic) / 1_000_000;

  const amountError = useMemo(() => {
    if (atomic !== null || !amount.trim()) return null;
    try {
      parseUsdcAmount(amount);
      return null;
    } catch (e) {
      return (e as Error).message; // AmountError messages are user-facing
    }
  }, [amount, atomic]);

  const route = routability(pair.fromChain, pair.toChain, pair.fromToken, pair.toToken);

  // Only a KNOWN balance can prove insufficiency. Treating an unloaded balance
  // as zero would block a user whose /overview call merely failed.
  const insufficientBalance = balance !== undefined && atomic !== null && amountIn > balance.amount;

  const blockedReason = !route.routable
    ? (route.reason ?? "This route isn't available yet.")
    : amountError
      ? amountError
      : insufficientBalance
        ? `You have ${balance!.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${pair.fromToken}.`
        : null;

  return {
    atomic,
    amountIn,
    amountError,
    canQuote: atomic !== null && route.routable && !insufficientBalance,
    blockedReason,
    insufficientBalance,
  };
}

// ── usePriceImpact ─────────────────────────────────────────────────────────

/**
 * Route cost beyond the fees the quote already declares, in percent.
 *
 * Returns `undefined` unless both assets are pegged to the SAME fiat currency.
 * That peg is the only reference price available offline; without it there is
 * no honest way to say what the trade "should" have returned, and a fabricated
 * impact number on a money screen is worse than none. Two same-peg stablecoins
 * should trade near 1:1, so:
 *
 *     impact = (amountIn − amountOut − declaredFees) / amountIn
 *
 * Fees are subtracted because they are disclosed separately in the breakdown;
 * counting them twice would make every ordinary swap look predatory.
 */
export function usePriceImpact(quote: SwapQuote | null): number | undefined {
  return useMemo(() => {
    if (!quote) return undefined;
    const from = assetBySymbol(quote.fromToken);
    const to = assetBySymbol(quote.toToken);
    if (!from?.peg || !to?.peg || from.peg !== to.peg) return undefined;
    if (quote.amountIn <= 0) return undefined;

    const declaredFees = quote.feeUsd + quote.gasUsd;
    const shortfall = quote.amountIn - quote.amountOut - declaredFees;
    // A negative shortfall means the route beat par. That is not "negative
    // impact" worth reporting — clamp to zero rather than show a bonus.
    return Math.max(0, (shortfall / quote.amountIn) * 100);
  }, [quote]);
}

// ── useSwapQuote ───────────────────────────────────────────────────────────

export interface UseSwapQuote {
  quote: SwapQuote | null;
  quoteId: string | null;
  quotedAt: number;
  quoting: boolean;
  error: string | null;
  /** Set when the quote was replaced by a re-price the user should re-read. */
  notice: string | null;
  expired: boolean;
  slippageBlocked: boolean;
  slippageWarn: boolean;
  requote: (notice?: string | null) => Promise<void>;
  clearNotice: () => void;
  reset: () => void;
}

export function useSwapQuote(pair: SwapPair, amountIn: number, enabled: boolean): UseSwapQuote {
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [quotedAt, setQuotedAt] = useState(0);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const idleRefreshes = useRef(0);
  // Kept in a ref so the auto-refresh timer always sends the CURRENT pair
  // without the timer itself being a dependency that restarts on every render.
  const latest = useRef({ pair, amountIn });
  latest.current = { pair, amountIn };

  const fetchQuote = useCallback(
    async (signal?: AbortSignal): Promise<QuoteResponse> => {
      const { pair: p, amountIn: amt } = latest.current;
      return api<QuoteResponse>("/swaps", {
        method: "POST",
        body: {
          fromToken: p.fromToken,
          toToken: p.toToken,
          fromChain: p.fromChain,
          toChain: p.toChain,
          amountIn: amt,
        },
        signal,
      });
    },
    []
  );

  const reset = useCallback(() => {
    setQuote(null);
    setQuoteId(null);
    setQuotedAt(0);
    setError(null);
    setExpired(false);
    // A "that quote expired" notice refers to a price that no longer exists
    // once the pair or amount changes — leaving it up would attach an old
    // explanation to a new number.
    setNotice(null);
    idleRefreshes.current = 0;
  }, []);

  // Live quoting. The cleanup aborts, so a superseded request can never land
  // after the one that replaced it.
  useEffect(() => {
    reset();
    if (!enabled) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setQuoting(true);
      fetchQuote(ctrl.signal)
        .then((res) => {
          setQuote(res.quote);
          setQuoteId(res.quoteId);
          setQuotedAt(Date.now());
        })
        .catch((e) => {
          if (e instanceof AbortedError) return; // superseded, not a failure
          setError(messageFor(e));
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setQuoting(false);
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [pair.fromToken, pair.toToken, pair.fromChain, pair.toChain, amountIn, enabled, fetchQuote, reset]);

  const requote = useCallback(
    async (message: string | null = null) => {
      setQuoting(true);
      setError(null);
      try {
        const res = await fetchQuote();
        setQuote(res.quote);
        setQuoteId(res.quoteId);
        setQuotedAt(Date.now());
        setExpired(false);
        setNotice(message);
      } catch (e) {
        if (e instanceof AbortedError) return;
        setError(messageFor(e));
      } finally {
        setQuoting(false);
      }
    },
    [fetchQuote]
  );

  // Auto-refresh at expiry, foreground only, with a budget. Backgrounded the
  // timer stops entirely — re-pricing an app the user cannot see spends their
  // rate limit and their battery for nothing.
  useEffect(() => {
    if (!quotedAt || !enabled) return;
    const due = quotedAt + QUOTE_TTL_MS - Date.now();
    const t = setTimeout(() => {
      if (AppState.currentState !== "active") return setExpired(true);
      if (idleRefreshes.current >= MAX_IDLE_REFRESHES) return setExpired(true);
      idleRefreshes.current += 1;
      void requote(null);
    }, Math.max(0, due));
    return () => clearTimeout(t);
  }, [quotedAt, enabled, requote]);

  // Any change to what is being swapped is user intent — restore the budget.
  useEffect(() => {
    idleRefreshes.current = 0;
  }, [pair.fromToken, pair.toToken, pair.fromChain, pair.toChain, amountIn]);

  const slippageBlocked = quote !== null && quote.slippagePct > MAX_SLIPPAGE_PCT;

  return {
    quote,
    quoteId,
    quotedAt,
    quoting,
    error,
    notice,
    expired,
    slippageBlocked,
    slippageWarn: quote !== null && quote.slippagePct > WARN_SLIPPAGE_PCT && !slippageBlocked,
    requote,
    clearNotice: useCallback(() => setNotice(null), []),
    reset,
  };
}

// ── useSwapExecution ───────────────────────────────────────────────────────

/**
 * Execution stages — shared with the send rail, defined in lib/execution.ts.
 *
 * These are the stages that ACTUALLY exist here. `/api/swaps` performs one
 * round trip and returns no transaction hash, so the timeline stops at
 * "settled" and shows no explorer link. When execution moves on-chain the
 * stages gain hashes; inventing them now would be showing the user a receipt
 * for something that did not happen.
 */
export type { ExecutionStage } from "@/lib/execution";

export interface UseSwapExecution {
  stage: ExecutionStage;
  /** Canonical transaction state. `stage` is UI vocabulary; this is money truth. */
  txState: TxState;
  /** Set when the risk engine refused. The API was never called. */
  blocked: string | null;
  /** Set when the swap needs review. The API was never called. */
  review: string | null;
  executing: boolean;
  executed: SwapQuote | null;
  error: string | null;
  /** Set when the deployment has execution switched off (server 503). */
  unavailable: string | null;
  correlationId: string | null;
  execute: () => Promise<void>;
  dismiss: () => void;
}

export function useSwapExecution(q: UseSwapQuote): UseSwapExecution {
  const refetchBalances = useInvalidateAfterMoneyMove();
  const [stage, setStage] = useState<ExecutionStage>("idle");
  const [txState, setTxState] = useState<TxState>("CREATED");
  const [blocked, setBlocked] = useState<string | null>(null);
  const [review, setReview] = useState<string | null>(null);
  const [executed, setExecuted] = useState<SwapQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);

  // Guards a double-commit: the swipe control springs back on interrupt, but a
  // second confirm arriving while the first request is in flight must not send
  // a second execution for the same quoteId.
  const inFlight = useRef(false);

  /**
   * Idempotency key, STABLE for a given quoteId.
   *
   * The execute call carried NO Idempotency-Key at all. The server's
   * single-use quoteId means a replayed request is refused rather than
   * double-executed, so this was not a double-spend — but a timeout had no
   * client-side identity to retry under, and the user was left unable to tell
   * whether their swap had happened. Keyed on quoteId so a retry of the SAME
   * quote replays the same key, while a re-quote is a new operation.
   */
  const idem = useRef<{ quoteId: string; key: string } | null>(null);
  const idempotencyKeyFor = useCallback((id: string): string => {
    if (idem.current?.quoteId !== id) idem.current = { quoteId: id, key: crypto.randomUUID() };
    return idem.current.key;
  }, []);

  const execute = useCallback(async () => {
    const { quote, quoteId, quotedAt, slippageBlocked, requote } = q;
    if (!quote || !quoteId || slippageBlocked || inFlight.current) return;

    setError(null);
    setUnavailable(null);
    setCorrelationId(null);
    setBlocked(null);
    setReview(null);

    // A stale quote is re-priced and handed back for review — never executed at
    // a rate the user never saw.
    if (Date.now() - quotedAt > QUOTE_TTL_MS) {
      await requote("That quote expired — this is the current price. Review it and swap again.");
      return;
    }

    // CLAIM THE ATTEMPT BEFORE THE PROMPT, not after.
    //
    // The flag used to be set below, after authorization returned, leaving the
    // entire prompt window — seconds, and the one moment the app is not in the
    // foreground — outside the guard. A second execute() arriving then saw
    // `inFlight.current === false`, raised a second prompt and ran a second
    // submission for the same quote. Send fixed this; swap had not.
    //
    // Every early return from here must release it, hence the try/finally now
    // spanning authorization as well as the request.
    inFlight.current = true;

    // Durable identity before risk, before the prompt, before the request.
    // Keyed on quoteId, so re-attempting the same quote is the same
    // transaction; a re-quote is a new one.
    const key = idempotencyKeyFor(quoteId);
    const tx = createTransaction({
      operation: "swap",
      idempotencyKey: key,
      amountUsd: Number(quote.amountIn) || 0,
      currency: quote.fromToken,
      reference: `Swap ${quote.fromToken} to ${quote.toToken}`,
      quoteId,
      quoteExpiresAt: quotedAt + QUOTE_TTL_MS,
    });

    setStage("authorizing");
    setTxState(tx.state);
    try {
      // Same authorization boundary as Send. Replaces confirmWithBiometrics,
      // which passed when biometric approvals were switched off.
      const decision = await authorizeMoneyMove({
        action: "swap",
        amountUsd: Number(quote.amountIn) || 0,
        reason: `Swap ${quote.amountIn} ${quote.fromToken} → ${quote.toToken}`,
      });
      if (!decision.ok) {
        if (decision.kind === "blocked") setBlocked(decision.message);
        else if (decision.kind === "review") setReview(decision.message);
        else if (decision.kind !== "declined") setError(decision.message);
        setTxState(updateTransactionState(tx.id, "CANCELLED", { lastError: decision.message }).state);
        setStage("idle");
        return;
      }

      // RE-CHECK THE QUOTE AFTER AUTHORIZATION.
      //
      // The TTL was checked before the prompt, but a fingerprint sheet can sit
      // open for longer than the quote lives. Without this a user could
      // authorize at one price and execute at another.
      if (Date.now() - quotedAt > QUOTE_TTL_MS) {
        setStage("idle");
        setTxState(
          updateTransactionState(tx.id, "CANCELLED", { lastError: "Quote expired during confirmation." }).state
        );
        await requote("That quote expired while you were confirming — this is the current price.");
        return;
      }

      setStage("submitting");
      setTxState(updateTransactionState(tx.id, "SUBMITTED").state);
      // Authorized against the quote the server issued and is holding: the
      // amount and route travel with quoteId, not as re-quotable parameters.
      const res = await api<{ quote: SwapQuote; executed: boolean }>("/swaps", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: {
          execute: true,
          quoteId,
          fromToken: quote.fromToken,
          toToken: quote.toToken,
          fromChain: quote.fromChain,
          toChain: quote.toChain,
          amountIn: quote.amountIn,
        },
      });
      // THE SERVER'S OWN FLAG DECIDES, not the fact that fetch resolved.
      //
      // /api/swaps returns `executed`, and this code ignored it: a 200 with
      // `executed: false` (the quote branch, a partially-applied route) showed
      // the user a completed swap. The response shape always carried the
      // answer; nothing read it.
      if (!res?.executed) {
        setTxState(updateTransactionState(tx.id, "PROCESSING", { reconcileRequired: true }).state);
        setStage("submitting");
        setError(
          "Your swap was accepted but hasn't been confirmed yet. It will appear in your activity once it settles — don't submit it again."
        );
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }

      updateTransactionState(tx.id, "PROCESSING");
      setTxState(updateTransactionState(tx.id, "COMPLETED").state);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setExecuted(res.quote);
      setStage("settled");
      // This swap is finished; a further swap is a new operation.
      idem.current = null;
      // A swap changes balances AND writes a transaction — refreshing only
      // ["overview"] left the activity list showing the pre-swap history.
      refetchBalances();
    } catch (e) {
      const code = e instanceof ApiError ? (e.data as { error?: string })?.error : undefined;

      // The id was refused — most often the biometric prompt outlasted the TTL.
      // Nothing settled, so re-price and let the user decide against the
      // current number instead of stranding them on an error.
      if (code === "expired" || code === "already_used") {
        inFlight.current = false;
        setStage("idle");
        await q.requote(
          "That quote expired before it was submitted — nothing was swapped. This is the current price."
        );
        return;
      }

      // This deployment quotes but does not execute (see the NODE_ENV gate in
      // apps/web/src/app/api/swaps/route.ts). That is a product state, not a
      // failure, and it deserves its own message rather than a red error.
      if (code === "service_unavailable" || (e instanceof ApiError && e.status === 503)) {
        const detail =
          (e instanceof ApiError ? (e.data as { detail?: string })?.detail : undefined) ??
          "Swap execution isn't enabled yet. Your quote is real — nothing was charged.";
        setUnavailable(detail);
        setStage("idle");
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }

      setCorrelationId(correlationOf(e));

      // A TIMEOUT IS NOT A FAILURE. The swap may have executed and the reply
      // been lost. Saying "failed" invites the user to swap again at a second
      // cost, so this becomes an unknown outcome for recovery to resolve.
      if (e instanceof TimeoutError) {
        setTxState(markUnknownOutcome(tx.id, "The network did not respond in time.").state);
        setStage("submitting");
        setError(
          "We didn't get a reply in time, so we don't yet know if this swap went through. We're checking — don't submit it again."
        );
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }

      setError(messageFor(e));
      setStage("failed");
      // Decided from the PERSISTED state: only a request that actually left can
      // be FAILED; anything earlier was abandoned before submission.
      const persisted = getTransaction(tx.id);
      setTxState(
        updateTransactionState(tx.id, persisted && persisted.state !== "CREATED" ? "FAILED" : "CANCELLED", {
          lastError: messageFor(e),
          errorClass: e instanceof ApiError ? (e.status >= 500 ? "server" : "client") : "transport",
        }).state
      );
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      inFlight.current = false;
    }
  }, [q, refetchBalances]);

  return {
    stage,
    txState,
    blocked,
    review,
    executing: stage === "authorizing" || stage === "submitting",
    executed,
    error,
    unavailable,
    correlationId,
    execute,
    dismiss: useCallback(() => {
      setExecuted(null);
      setError(null);
      setUnavailable(null);
      setBlocked(null);
      setReview(null);
      setStage("idle");
      setTxState("CREATED");
    }, []),
  };
}

// ── shared ─────────────────────────────────────────────────────────────────

export { messageFor } from "@/lib/execution";

/** Every warning for the current pair and amount, most severe first. */
export function useSwapWarnings(
  quote: SwapQuote | null,
  priceImpactPct: number | undefined,
  fromAsset?: SwapAsset,
  toAsset?: SwapAsset
): SwapWarning[] {
  return useMemo(() => {
    if (!quote) return [];
    return swapWarnings({
      // amountIn is denominated in the source token; for the pegged assets this
      // screen deals in that is within rounding of USD. A non-pegged asset gets
      // no large-swap warning rather than one computed from a price we do not
      // have.
      amountUsd: fromAsset?.peg === "USD" ? quote.amountIn : 0,
      priceImpactPct,
      slippagePct: quote.slippagePct,
      fromChain: quote.fromChain as ChainId,
      toChain: quote.toChain as ChainId,
      fromAsset,
      toAsset,
    });
  }, [quote, priceImpactPct, fromAsset, toAsset]);
}
