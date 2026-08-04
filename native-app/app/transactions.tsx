import React, { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTransactions } from "@/lib/queries";
import { colors, radius, spacing, type } from "@/lib/theme";
import { EmptyState, Field, Screen } from "@/components/ui";
import { TransactionRow } from "@/components/TransactionRow";
import { VoiceSearchButton, VoiceStatus } from "@/components/VoiceSearchButton";
import { timeAgo } from "@/lib/format";

const CATEGORIES = ["all", "transfer", "card", "swap", "invest", "bill", "ramp", "yield"] as const;

export default function Transactions() {
  // Deep-linkable initial filter — e.g. Invest links here with ?category=invest
  // as the order-history view.
  const { category: initial } = useLocalSearchParams<{ category?: string }>();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>(
    CATEGORIES.includes(initial as (typeof CATEGORIES)[number])
      ? (initial as (typeof CATEGORIES)[number])
      : "all"
  );
  const [query, setQuery] = useState("");
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const { data: result, isLoading, refetch, isRefetching, error } = useTransactions(
    category === "all" ? undefined : category
  );
  const q = query.trim().toLowerCase();
  const txs = (result?.data ?? []).filter(
    (tx) =>
      !q ||
      tx.title.toLowerCase().includes(q) ||
      tx.subtitle.toLowerCase().includes(q) ||
      (tx.token ?? "").toLowerCase().includes(q)
  );

  return (
    <Screen>
      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>
        <Field
          value={query}
          onChangeText={setQuery}
          placeholder="Search transactions…"
          autoCapitalize="none"
          autoCorrect={false}
          clearable
          right={
            <VoiceSearchButton
              onPartial={setQuery}
              onTranscript={setQuery}
              onStatus={setVoiceNote}
            />
          }
        />
        <VoiceStatus message={voiceNote} />
      </View>
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
            title={
              isLoading
                ? "Loading…"
                : error
                  ? "Couldn't load transactions"
                  : q
                    ? "No matches"
                    : "No transactions"
            }
            subtitle={error ? (error as Error).message : q ? `Nothing matching “${query.trim()}”.` : undefined}
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
