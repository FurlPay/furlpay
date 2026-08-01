import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, radius, type } from "@/lib/theme";
import { timeAgo, usd } from "@/lib/format";
import type { Transaction, TxCategory } from "@/lib/types";

const CATEGORY_ICON: Record<TxCategory, keyof typeof Ionicons.glyphMap> = {
  card: "card-outline",
  transfer: "swap-horizontal-outline",
  swap: "repeat-outline",
  invest: "trending-up-outline",
  bill: "receipt-outline",
  ramp: "cash-outline",
  yield: "leaf-outline",
};

// Memoized: this row is the repeated element of the transactions FlatList and
// of the home screen's activity card, both of which re-render on every balance
// refetch. `tx` objects come straight from the query cache, and react-query's
// structural sharing keeps the identity of unchanged rows stable — so a refetch
// that returns the same history re-renders none of them.
export const TransactionRow = React.memo(function TransactionRow({ tx }: { tx: Transaction }) {
  const router = useRouter();
  const inbound = tx.direction === "in";
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/transaction/[id]", params: { id: tx.id } })}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.icon}>
        <Ionicons
          name={CATEGORY_ICON[tx.category] ?? "ellipse-outline"}
          size={18}
          color={colors.textDim}
        />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.body} numberOfLines={1}>
          {tx.title}
        </Text>
        <Text style={type.dim} numberOfLines={1}>
          {tx.subtitle}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Text style={[type.body, { fontWeight: "700", color: inbound ? colors.neon : colors.text }]}>
          {inbound ? "+" : "-"}
          {usd(tx.amountUsd)}
        </Text>
        <Text style={type.dim}>
          {tx.status === "settled" ? timeAgo(tx.timestamp) : tx.status}
        </Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
});
