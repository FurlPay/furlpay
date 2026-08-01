import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AmountInput } from "@/components/money/AmountInput";
import { ProgressTimeline, swapSteps } from "@/components/money/ProgressTimeline";
import { SwipeToConfirm } from "@/components/money/SwipeToConfirm";
import { ValuePanel } from "@/components/money/ValuePanel";
import { WarningList } from "@/components/money/WarningList";
import { FeeBreakdown, QuoteCountdown } from "@/components/swap/QuoteDetails";
import { SlippageSelector } from "@/components/swap/SlippageSelector";
import { FlipButton, ReceiveAmount } from "@/components/swap/SwapCard";
import { TokenSelector } from "@/components/swap/TokenSelector";
import { Button, ErrorNote, Screen } from "@/components/ui";
import { type ChainId, type SwapAsset } from "@/lib/swap/assets";
import {
  AMOUNT_MAX_LENGTH,
  MAX_SLIPPAGE_PCT,
  QUOTE_TTL_MS,
  useRouting,
  useSwapExecution,
  useSwapQuote,
  useSwapValidation,
  useSwapWarnings,
  useTokenBalances,
  usePriceImpact,
  type SwapPair,
} from "@/lib/swap/useSwap";
import { colors, radius, spacing, type } from "@/lib/theme";

// Cross-chain swap.
//
// The safety rules live in lib/swap/useSwap.ts, not here, so that changing how
// this screen LOOKS cannot change what it is allowed to DO. This file is the
// presentation layer: it renders state and forwards intent.
//
// The one rule that is enforced here as well as there is the confirm gate. The
// swipe is disabled unless every check passes, and the reason is always shown
// on the control itself — a disabled button with no explanation is the single
// most common way a payment screen wastes a user's time.

const RECENTS_LIMIT = 4;

export default function Swap() {
  const [pair, setPair] = useState<SwapPair>({
    fromToken: "USDT",
    toToken: "USDC",
    fromChain: "arbitrum",
    toChain: "arbitrum",
  });
  const [amount, setAmount] = useState("100");
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const [maxSlippage, setMaxSlippage] = useState<number>(MAX_SLIPPAGE_PCT);

  const { balanceOf } = useTokenBalances();
  const held = balanceOf(pair.fromToken, pair.fromChain);

  const routing = useRouting(pair);
  const validation = useSwapValidation(amount, pair, held);
  const q = useSwapQuote(pair, validation.amountIn, validation.canQuote);
  const priceImpactPct = usePriceImpact(q.quote);
  const warnings = useSwapWarnings(q.quote, priceImpactPct, routing.fromAsset, routing.toAsset);
  const exec = useSwapExecution(q);

  // The user's own ceiling tightens the hard 5% limit; it can never loosen it.
  const slippageRejected =
    q.quote !== null && (q.quote.slippagePct > maxSlippage || q.slippageBlocked);

  const remember = useCallback((symbol: string) => {
    setRecents((r) => [symbol, ...r.filter((s) => s !== symbol)].slice(0, RECENTS_LIMIT));
  }, []);

  const choose = useCallback(
    (asset: SwapAsset, chain: ChainId) => {
      remember(asset.symbol);
      setPair((p) =>
        picking === "from"
          ? { ...p, fromToken: asset.symbol, fromChain: chain }
          : { ...p, toToken: asset.symbol, toChain: chain }
      );
    },
    [picking, remember]
  );

  const flip = useCallback(() => {
    setPair((p) => ({
      fromToken: p.toToken,
      toToken: p.fromToken,
      fromChain: p.toChain,
      toChain: p.fromChain,
    }));
  }, []);

  /**
   * Percentage shortcuts derive from the BALANCE, not the displayed string, and
   * are truncated to 6dp so the result is always a value parseUsdcAmount
   * accepts. Max uses the exact held amount — rounding it up would produce an
   * amount the user cannot actually swap.
   */
  const applyPercent = useCallback(
    (fraction: number) => {
      if (!held) return;
      const raw = fraction >= 1 ? held.amount : held.amount * fraction;
      const truncated = Math.floor(raw * 1e6) / 1e6;
      setAmount(truncated > 0 ? String(truncated) : "0");
    },
    [held]
  );

  /**
   * Fiat value of what the user is paying.
   *
   * Derived from the balance snapshot the server already priced
   * (usdValue / amount), not from a client-side price table. When there is no
   * balance there is no unit price, and the row simply doesn't render — a made
   * up dollar figure next to a real one is indistinguishable from a real one.
   */
  const fiatValue = useMemo(() => {
    if (!held || held.amount <= 0 || validation.atomic === null) return undefined;
    return (held.usdValue / held.amount) * validation.amountIn;
  }, [held, validation.atomic, validation.amountIn]);

  const confirmBlockedReason = useMemo(() => {
    if (validation.blockedReason) return validation.blockedReason;
    if (q.error) return null; // shown separately, in full
    if (!q.quote) return q.quoting ? "Finding the best route…" : "Enter an amount";
    if (q.slippageBlocked) return `Slippage above the ${MAX_SLIPPAGE_PCT}% limit`;
    if (slippageRejected) return `Above your ${maxSlippage}% slippage limit`;
    return null;
  }, [validation.blockedReason, q.error, q.quote, q.quoting, q.slippageBlocked, slippageRejected, maxSlippage]);

  // ── receipt ──────────────────────────────────────────────────────────────
  if (exec.executed) {
    const done = exec.executed;
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.receipt}>
          <View style={styles.tick}>
            <Ionicons name="checkmark" size={40} color={colors.onNeon} />
          </View>
          <Text style={type.h2}>Swap complete</Text>
          <Text style={[type.dim, { textAlign: "center" }]}>
            {done.amountIn} {done.fromToken} → {done.amountOut.toFixed(6)} {done.toToken}
          </Text>
          <View style={{ alignSelf: "stretch", marginTop: spacing.md }}>
            <ProgressTimeline
              stage="settled"
              steps={swapSteps(done.fromChain as ChainId, done.toChain as ChainId)}
            />
          </View>
          <Button title="Done" onPress={exec.dismiss} style={{ alignSelf: "stretch" }} />
        </ScrollView>
      </Screen>
    );
  }

  // ── in-flight ────────────────────────────────────────────────────────────
  if (exec.executing || exec.stage === "failed") {
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={type.h2}>
            {exec.stage === "failed" ? "Swap didn't go through" : "Swapping"}
          </Text>
          <ProgressTimeline
            stage={exec.stage}
            steps={swapSteps(pair.fromChain, pair.toChain)}
          />
          {exec.error ? <ErrorNote message={exec.error} /> : null}
          {exec.correlationId ? (
            <Text style={styles.correlation}>Reference {exec.correlationId}</Text>
          ) : null}
          {exec.stage === "failed" ? (
            <Button title="Back" onPress={exec.dismiss} />
          ) : null}
        </ScrollView>
      </Screen>
    );
  }

  // ── composer ─────────────────────────────────────────────────────────────
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ValuePanel
          caption="YOU PAY"
          asset={routing.fromAsset}
          chain={pair.fromChain}
          onPress={() => setPicking("from")}
        >
          <AmountInput
            value={amount}
            onChangeText={setAmount}
            balance={held?.amount}
            balanceSymbol={pair.fromToken}
            fiatValue={fiatValue}
            error={validation.amountError ?? (validation.insufficientBalance ? validation.blockedReason : null)}
            maxLength={AMOUNT_MAX_LENGTH}
            onPercent={applyPercent}
            accessibilityLabel="Amount to swap"
          />
        </ValuePanel>

        <FlipButton onPress={flip} />

        <ValuePanel
          caption="YOU RECEIVE"
          asset={routing.toAsset}
          chain={pair.toChain}
          onPress={() => setPicking("to")}
        >
          <ReceiveAmount
            amount={q.quote?.amountOut}
            symbol={pair.toToken}
            loading={q.quoting}
          />
          {q.quotedAt || q.quoting ? (
            // Kept mounted when expired: the countdown lands on "Quote
            // expired" and becomes the tap-to-refresh affordance. Hiding it
            // would leave a stale price on screen with nothing to act on.
            <QuoteCountdown
              quotedAt={q.quotedAt}
              ttlMs={QUOTE_TTL_MS}
              refreshing={q.quoting}
              onRefresh={() => void q.requote(null)}
            />
          ) : null}
        </ValuePanel>

        {!routing.routable ? (
          <View style={styles.unroutable}>
            <Ionicons name="time-outline" size={16} color={colors.warning} />
            <Text style={[type.dim, { flex: 1 }]}>{routing.reason}</Text>
          </View>
        ) : null}

        {q.notice ? (
          <Pressable onPress={q.clearNotice} style={styles.notice} accessibilityRole="alert">
            <Ionicons name="information-circle" size={16} color={colors.warning} />
            <Text style={[type.dim, { flex: 1, color: colors.warning }]}>{q.notice}</Text>
          </Pressable>
        ) : null}

        {exec.unavailable ? (
          <View style={styles.notice} accessibilityRole="alert">
            <Ionicons name="construct-outline" size={16} color={colors.warning} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.noticeTitle}>Execution not enabled here</Text>
              <Text style={type.dim}>{exec.unavailable}</Text>
            </View>
          </View>
        ) : null}

        {q.quote ? (
          <FeeBreakdown quote={{ ...q.quote, fromChain: q.quote.fromChain as ChainId, toChain: q.quote.toChain as ChainId, priceImpactPct }} />
        ) : null}

        <WarningList warnings={warnings} />

        <SlippageSelector
          value={maxSlippage}
          onChange={setMaxSlippage}
          quoted={q.quote?.slippagePct}
        />

        <ErrorNote message={q.error} />

        <SwipeToConfirm
          noun="swap"
          label={`Swipe to swap${q.quote ? ` for ${q.quote.amountOut.toFixed(4)} ${pair.toToken}` : ""}`}
          confirmingLabel="Swapping…"
          disabled={!q.quote || !q.quoteId || q.quoting}
          disabledReason={confirmBlockedReason ?? undefined}
          onConfirm={() => void exec.execute()}
        />
      </ScrollView>

      <TokenSelector
        visible={picking !== null}
        title={picking === "from" ? "Swap from" : "Swap to"}
        selected={picking === "from" ? pair.fromToken : pair.toToken}
        selectedChain={picking === "from" ? pair.fromChain : pair.toChain}
        recents={recents}
        onClose={() => setPicking(null)}
        onSelect={choose}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  receipt: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  tick: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.neon,
    alignItems: "center",
    justifyContent: "center",
  },
  notice: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.warning + "55",
  },
  noticeTitle: { color: colors.warning, fontSize: 13, fontWeight: "700" },
  unroutable: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  correlation: { color: colors.textFaint, fontSize: 11, fontFamily: "monospace", textAlign: "center" },
});
