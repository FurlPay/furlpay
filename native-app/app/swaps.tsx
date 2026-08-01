import React, { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { EmptyState, Screen } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { listSwaps, type SwapRecord } from "@/lib/swap/swapJournal";
import { describeSwap, presentSwap, type SwapTone } from "@/lib/swap/swapPresentation";
import { resumeOpenSwaps } from "@/lib/swap/resumeBridges";

// Swap history, read straight from the local journal.
//
// Reads on focus rather than on an interval: the journal is written by
// executeSwap and by the launch reconciler, so the only moment this screen can
// be stale is the moment the user arrives at it. Pull-to-refresh re-runs the
// reconciler, which is the honest "check again" — it asks the network rather
// than re-rendering the same rows.

// Pending is deliberately DIMMER than success rather than the same neon: a
// swap still in flight must not read at a glance like one that landed. Colour
// is never the only signal — the icon and the headline both carry it too, for
// the same reason and for anyone who cannot distinguish these hues.
const TONE_COLOR: Record<SwapTone, string> = {
  pending: colors.textDim,
  success: colors.neon,
  warning: colors.warning,
  failure: colors.accent,
};

const TONE_ICON: Record<SwapTone, keyof typeof Ionicons.glyphMap> = {
  pending: "time-outline",
  success: "checkmark-circle-outline",
  warning: "alert-circle-outline",
  failure: "close-circle-outline",
};

function SwapRow({ swap, onPress }: { swap: SwapRecord; onPress: () => void }) {
  const view = presentSwap(swap);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${describeSwap(swap)}. ${view.headline}.`}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.icon, { borderColor: TONE_COLOR[view.tone] }]}>
        <Ionicons name={TONE_ICON[view.tone]} size={18} color={TONE_COLOR[view.tone]} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.body} numberOfLines={1}>
          {describeSwap(swap)}
        </Text>
        <Text style={[type.dim, { color: TONE_COLOR[view.tone] }]} numberOfLines={1}>
          {view.headline}
          {view.needsAttention ? " · needs attention" : ""}
        </Text>
      </View>
      <Text style={type.dim}>{timeAgo(swap.createdAt)}</Text>
    </Pressable>
  );
}

export default function Swaps() {
  const router = useRouter();
  const [swaps, setSwaps] = useState<SwapRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    try {
      setSwaps(listSwaps());
    } catch {
      // A journal read failure is an empty list, not a crash — history is not
      // worth taking the screen down for.
      setSwaps([]);
    }
  }, []);

  useFocusEffect(load);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    // Re-reads real state from the network for anything still open, then
    // re-renders from the updated journal.
    await resumeOpenSwaps();
    load();
    setRefreshing(false);
  }, [load]);

  return (
    <Screen>
      <FlatList
        data={swaps}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.neon} />
        }
        renderItem={({ item }) => (
          <SwapRow swap={item} onPress={() => router.push(`/swaps/${encodeURIComponent(item.id)}`)} />
        )}
        ListEmptyComponent={
          <EmptyState
            title="No swaps yet"
            subtitle="Swaps you make will appear here, including any still on their way."
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
