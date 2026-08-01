import React, { useCallback, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { EmptyState, Screen, SectionHeader, SummaryRow, Surface } from "@/components/ui";
import { colors, radius, spacing, type } from "@/lib/theme";
import { explorerTxUrl, useChains } from "@/lib/explorer";
import { getSwap, type SwapRecord } from "@/lib/swap/swapJournal";
import { describeSwap, presentSwap, swapTimeline } from "@/lib/swap/swapPresentation";

// Detail view for one swap: what happened, when, and where to look it up.
//
// Every hash here is a link ONLY when we can resolve the right explorer for its
// chain (see lib/explorer.ts). A link that goes to the wrong chain shows
// "transaction not found" for a transaction that exists, which reads as lost
// funds — so a missing explorer renders as plain monospace text instead.

function TimelineRow({
  label,
  at,
  state,
  last,
}: {
  label: string;
  at: number | null;
  state: "done" | "active" | "pending" | "failed";
  last: boolean;
}) {
  const color =
    state === "done"
      ? colors.neon
      : state === "failed"
        ? colors.accent
        : state === "active"
          ? colors.warning
          : colors.textDim;

  return (
    <View style={styles.timelineRow}>
      <View style={{ alignItems: "center" }}>
        <View style={[styles.dot, { borderColor: color, backgroundColor: state === "done" ? color : "transparent" }]} />
        {!last && <View style={styles.line} />}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : spacing.md }}>
        <Text style={[type.body, state === "pending" && { color: colors.textDim }]}>{label}</Text>
        {at ? (
          <Text style={type.dim}>
            {new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function HashRow({
  label,
  hash,
  chain,
  chains,
}: {
  label: string;
  hash: string | null;
  chain: string;
  chains: { id: string; name: string; chainId: number; explorer: string }[];
}) {
  if (!hash) return null;
  const url = explorerTxUrl(chain, hash, chains);
  const short = `${hash.slice(0, 10)}…${hash.slice(-8)}`;

  if (!url) {
    // Known hash, unknown explorer. Show the hash — it is still the thing the
    // user needs — but do not offer a link we cannot honour.
    return <SummaryRow k={label} v={short} />;
  }
  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      accessibilityRole="link"
      accessibilityLabel={`${label}, open in block explorer`}
      style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.6 }]}
    >
      <Text style={type.dim}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text style={[type.mono, { color: colors.neon }]}>{short}</Text>
        <Ionicons name="open-outline" size={14} color={colors.neon} />
      </View>
    </Pressable>
  );
}

export default function SwapDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [swap, setSwap] = useState<SwapRecord | null>(null);
  const { data: chains = [] } = useChains();

  useFocusEffect(
    useCallback(() => {
      try {
        setSwap(id ? getSwap(id) : null);
      } catch {
        setSwap(null);
      }
    }, [id])
  );

  if (!swap) {
    return (
      <Screen>
        <EmptyState title="Swap not found" subtitle="This swap is no longer in your history." />
      </Screen>
    );
  }

  const view = presentSwap(swap);
  const timeline = swapTimeline(swap);
  const bridged = swap.fromChain !== swap.toChain;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
        <Surface style={{ gap: 6 }}>
          <Text style={type.h2}>{view.headline}</Text>
          <Text style={type.body}>{describeSwap(swap)}</Text>
          {view.detail ? <Text style={type.dim}>{view.detail}</Text> : null}
        </Surface>

        <View>
          <SectionHeader title="Timeline" />
          <Surface>
            {timeline.map((entry, i) => (
              <TimelineRow
                key={`${entry.label}-${i}`}
                label={entry.label}
                at={entry.at}
                state={entry.state}
                last={i === timeline.length - 1}
              />
            ))}
          </Surface>
        </View>

        <View>
          <SectionHeader title="Details" />
          <Surface style={{ gap: 2 }}>
            <SummaryRow k="Sent" v={`${swap.amountIn} ${swap.fromToken}`} />
            {swap.amountOut ? (
              <SummaryRow k="Received" v={`~${swap.amountOut} ${swap.toToken}`} />
            ) : null}
            <SummaryRow k="From" v={swap.fromChain} />
            <SummaryRow k="To" v={swap.toChain} />
            <SummaryRow k="Started" v={new Date(swap.createdAt).toLocaleString()} />
            {/* The route id is what a support ticket starts from. */}
            {swap.routeId ? <SummaryRow k="Reference" v={swap.routeId} /> : null}
          </Surface>
        </View>

        <View>
          <SectionHeader title="Transactions" />
          <Surface style={{ gap: 2 }}>
            <HashRow label="Approval" hash={swap.approvalTxHash} chain={swap.fromChain} chains={chains} />
            <HashRow
              label={bridged ? `Source (${swap.fromChain})` : "Transaction"}
              hash={swap.txHash}
              chain={swap.fromChain}
              chains={chains}
            />
            {bridged ? (
              <HashRow
                label={`Destination (${swap.toChain})`}
                hash={swap.destTxHash}
                chain={swap.toChain}
                chains={chains}
              />
            ) : null}
            {!swap.txHash ? (
              <Text style={type.dim}>Nothing was broadcast — no transaction to show.</Text>
            ) : null}
          </Surface>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  timelineRow: { flexDirection: "row", gap: spacing.sm },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  line: { width: 2, flex: 1, backgroundColor: colors.border, marginVertical: 2 },
  linkRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
});
