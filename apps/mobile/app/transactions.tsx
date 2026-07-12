import React, { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useTransactions } from "@/lib/queries";
import { colors, radius, spacing, type } from "@/lib/theme";
import { EmptyState, Screen } from "@/components/ui";
import { TransactionRow } from "@/components/TransactionRow";
import { timeAgo } from "@/lib/format";

const CATEGORIES = ["all", "transfer", "card", "swap", "invest", "bill", "ramp", "yield"] as const;

export default function Transactions() {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("all");
  const { data: result, isLoading, refetch, isRefetching, error } = useTransactions(
    category === "all" ? undefined : category
  );
  const txs = result?.data ?? [];

  return (
    <Screen>
      <View style={styles.filters}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={CATEGORIES}
          keyExtractor={(c) => c}
          contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }}
          renderItem={({ item }) => {
            const active = item === category;
            return (
              <Pressable
                onPress={() => setCategory(item)}
                style={[styles.chip, active && { backgroundColor: colors.neon }]}
              >
                <Text
                  style={{
                    color: active ? colors.onNeon : colors.textDim,
                    fontWeight: "600",
                    textTransform: "capitalize",
                  }}
                >
                  {item}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>
      {result?.fromCache ? (
        <Text style={[type.dim, { paddingHorizontal: spacing.md, paddingBottom: spacing.sm }]}>
          Offline — cached{result.updatedAt ? ` ${timeAgo(result.updatedAt)}` : ""}
        </Text>
      ) : null}
      <FlatList
        data={txs}
        keyExtractor={(tx) => tx.id}
        renderItem={({ item }) => <TransactionRow tx={item} />}
        contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.xl }}
        refreshing={isRefetching}
        onRefresh={() => void refetch()}
        ListEmptyComponent={
          <EmptyState
            title={isLoading ? "Loading…" : error ? "Couldn't load transactions" : "No transactions"}
            subtitle={error ? (error as Error).message : undefined}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { paddingVertical: spacing.sm },
  chip: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});
