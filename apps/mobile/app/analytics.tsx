import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { EmptyState, Screen, SectionHeader, Surface } from "@/components/ui";

interface Analytics {
  period: string;
  totalSpent: number;
  transactionCount: number;
  categories: { label: string; amount: number; count: number; pct: number }[];
  topMerchants: { name: string; amount: number }[];
}

// Category colors — neon-forward palette matching the web's stacked bars.
const BAR_COLORS = ["#00E599", "#4CC2FF", "#F59E0B", "#FF3B30", "#A78BFA", "#6B7280"];

export default function AnalyticsScreen() {
  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["analytics"],
    queryFn: () => api<Analytics>("/analytics"),
  });

  if (!data) {
    return (
      <Screen>
        <EmptyState
          title={isLoading ? "Loading…" : "Couldn't load analytics"}
          subtitle={error ? (error as Error).message : undefined}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.neon} />
        }
      >
        <View style={{ gap: 4 }}>
          <Text style={type.dim}>{data.period}</Text>
          <Text style={styles.hero}>{usd(data.totalSpent)}</Text>
          <Text style={type.dim}>{data.transactionCount} card & bill payments</Text>
        </View>

        {/* Stacked proportion bar */}
        {data.categories.length > 0 ? (
          <View style={styles.stack}>
            {data.categories.map((c, i) => (
              <View
                key={c.label}
                style={{
                  flex: Math.max(c.pct, 2),
                  backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                }}
              />
            ))}
          </View>
        ) : null}

        <SectionHeader title="By category" />
        <Surface style={{ paddingVertical: 4 }}>
          {data.categories.length === 0 ? (
            <EmptyState title="No spend yet" subtitle="Card and bill payments are categorized here." />
          ) : (
            data.categories.map((c, i) => (
              <View key={c.label} style={styles.row}>
                <View style={[styles.dot, { backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }]} />
                <View style={{ flex: 1 }}>
                  <Text style={type.body}>{c.label}</Text>
                  <Text style={type.dim}>
                    {c.count} payment{c.count === 1 ? "" : "s"}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[type.body, { fontWeight: "700" }]}>{usd(c.amount)}</Text>
                  <Text style={type.dim}>{c.pct}%</Text>
                </View>
              </View>
            ))
          )}
        </Surface>

        <SectionHeader title="Top merchants" />
        <Surface style={{ paddingVertical: 4 }}>
          {data.topMerchants.map((m, i) => (
            <View key={m.name} style={styles.row}>
              <Text style={[type.dim, { width: 20 }]}>{i + 1}</Text>
              <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>
                {m.name}
              </Text>
              <Text style={[type.body, { fontWeight: "700" }]}>{usd(m.amount)}</Text>
            </View>
          ))}
        </Surface>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  hero: { fontSize: 36, fontWeight: "800", color: colors.text, letterSpacing: -1 },
  stack: {
    flexDirection: "row",
    height: 14,
    borderRadius: radius.pill,
    overflow: "hidden",
    gap: 2,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
