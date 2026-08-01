import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CHAINS, type ChainId } from "@/lib/swap/assets";
import { colors, radius, spacing, type } from "@/lib/theme";

// Quote freshness and fee breakdown. Warnings render through the shared
// components/money/WarningList so they look identical on every money screen.
//
// THE COUNTDOWN IS A SAFETY CONTROL, NOT DECORATION. The screen re-prices a
// stale quote instead of executing it, and the server refuses an expired
// quoteId outright. A user who cannot see the clock experiences that as a
// random failure; one who can sees a deadline and acts on it. The ring drains
// so the state is legible without reading a number.
//
// Fees are itemised because a single "you receive" figure invites the question
// "why is it less than I expected", and the honest answer has three parts.

export interface QuoteFacts {
  amountIn: number;
  amountOut: number;
  fromToken: string;
  toToken: string;
  fromChain: ChainId;
  toChain: ChainId;
  slippagePct: number;
  gasUsd: number;
  feeUsd: number;
  route: string[];
  etaSeconds: number;
  source: string;
  priceImpactPct?: number;
}

export function QuoteCountdown({
  quotedAt,
  ttlMs,
  refreshing,
  onRefresh,
}: {
  quotedAt: number;
  ttlMs: number;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const [remaining, setRemaining] = useState(ttlMs);
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!quotedAt) return;
    const tick = () => setRemaining(Math.max(0, ttlMs - (Date.now() - quotedAt)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [quotedAt, ttlMs]);

  useEffect(() => {
    if (!refreshing) return spin.stopAnimation();
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 900, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [refreshing, spin]);

  const seconds = Math.ceil(remaining / 1000);
  const expiring = remaining < 8_000;
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  if (!quotedAt && !refreshing) return null;

  return (
    <Pressable
      onPress={onRefresh}
      disabled={!onRefresh || refreshing}
      style={styles.countdown}
      accessibilityRole="button"
      accessibilityLabel={
        refreshing
          ? "Refreshing quote"
          : `Quote expires in ${seconds} seconds. Activate to refresh.`
      }
      accessibilityLiveRegion={expiring ? "polite" : "none"}
    >
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Ionicons
          name="refresh"
          size={13}
          color={refreshing ? colors.neon : expiring ? colors.warning : colors.textFaint}
        />
      </Animated.View>
      <Text
        style={[
          styles.countdownText,
          { color: refreshing ? colors.neon : expiring ? colors.warning : colors.textFaint },
        ]}
      >
        {refreshing ? "Updating price…" : remaining <= 0 ? "Quote expired" : `Refreshes in ${seconds}s`}
      </Text>
    </Pressable>
  );
}

export function FeeBreakdown({ quote }: { quote: QuoteFacts }) {
  const [open, setOpen] = useState(false);
  const crossChain = quote.fromChain !== quote.toChain;
  const rate = quote.amountIn > 0 ? quote.amountOut / quote.amountIn : 0;
  // The floor the user is protected to. Anything below this and the swap
  // should fail rather than fill.
  const minReceived = quote.amountOut * (1 - quote.slippagePct / 100);

  return (
    <View style={styles.card}>
      <Row
        label="Rate"
        value={`1 ${quote.fromToken} ≈ ${rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${quote.toToken}`}
      />
      <Row
        label="Minimum received"
        value={`${minReceived.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${quote.toToken}`}
        hint="You will never receive less than this. The swap fails instead."
      />
      <Row
        label="Arrives in"
        value={quote.etaSeconds < 60 ? `~${quote.etaSeconds}s` : `~${Math.ceil(quote.etaSeconds / 60)} min`}
      />

      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={styles.disclosure}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? "Hide advanced details" : "Show advanced details"}
      >
        <Text style={styles.disclosureText}>Advanced details</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.textFaint} />
      </Pressable>

      {open ? (
        <View style={{ gap: spacing.sm }}>
          <Row label="Network fee" value={`$${quote.gasUsd.toFixed(2)}`} />
          <Row label="FurlPay fee" value={`$${quote.feeUsd.toFixed(2)}`} />
          <Row label="Max slippage" value={`${quote.slippagePct.toFixed(2)}%`} />
          {quote.priceImpactPct !== undefined ? (
            <Row label="Price impact" value={`${quote.priceImpactPct.toFixed(2)}%`} />
          ) : null}
          <Row label="Source chain" value={CHAINS[quote.fromChain].name} />
          <Row label="Destination" value={CHAINS[quote.toChain].name} />
          <Row label="Router" value={quote.source === "lifi" ? "LI.FI" : quote.source} />
          {quote.route.length ? <Row label="Route" value={quote.route.join(" → ")} /> : null}
          {crossChain ? (
            <Text style={[type.dim, styles.disclaimer]}>
              Cross-chain swaps settle through a bridge. Once the source transaction confirms the
              swap cannot be cancelled, and completion depends on the destination chain.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <View style={{ flex: 1 }}>
        <Text style={type.dim}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Text style={styles.value} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  value: { color: colors.text, fontSize: 13, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  hint: { color: colors.textFaint, fontSize: 11, marginTop: 1 },
  disclosure: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  disclosureText: { color: colors.textFaint, fontSize: 13, fontWeight: "600" },
  disclaimer: { marginTop: spacing.xs, lineHeight: 18 },
  countdown: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center" },
  countdownText: { fontSize: 12, fontWeight: "600" },
});
