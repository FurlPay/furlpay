import React from "react";
import { FlatList, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api, API_BASE } from "@/lib/api";
import { colors, radius, spacing, type } from "@/lib/theme";
import { EmptyState, Screen } from "@/components/ui";

interface Insight {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  date: string;
  readMins: number;
  signal: "bullish" | "bearish" | "neutral" | null;
  tickers: string[];
  featured: boolean;
}

const SIGNAL_COLOR: Record<string, string> = {
  bullish: colors.neon,
  bearish: colors.accent,
  neutral: colors.textDim,
};

export default function Insights() {
  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["insights"],
    queryFn: () => api<{ items: Insight[] }>("/insights"),
    staleTime: 5 * 60_000,
  });
  const items = data?.items ?? [];
  const siteBase = API_BASE.replace(/\/api$/, "");

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(i) => i.slug}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl }}
        refreshing={isRefetching}
        onRefresh={() => void refetch()}
        renderItem={({ item }) => (
          <Pressable
            // Articles render server-side on the public research portal.
            onPress={() => void Linking.openURL(`${siteBase}/investing/insights/${item.slug}`)}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
          >
            <View style={styles.meta}>
              <Text style={[type.dim, { textTransform: "uppercase", fontSize: 11, letterSpacing: 1 }]}>
                {item.category}
              </Text>
              {item.signal ? (
                <Text style={{ color: SIGNAL_COLOR[item.signal], fontWeight: "800", fontSize: 11 }}>
                  {item.signal.toUpperCase()}
                </Text>
              ) : null}
            </View>
            <Text style={[type.body, { fontWeight: "700", fontSize: 17 }]}>{item.title}</Text>
            <Text style={type.dim} numberOfLines={3}>
              {item.excerpt}
            </Text>
            <View style={styles.meta}>
              <Text style={[type.dim, { fontSize: 12 }]}>
                {new Date(item.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ·{" "}
                {item.readMins} min read
              </Text>
              <Text style={[type.dim, { fontSize: 12, color: colors.neon }]}>
                {item.tickers.slice(0, 4).join(" · ")}
              </Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <EmptyState
            title={isLoading ? "Loading…" : error ? "Couldn't load research" : "No articles yet"}
            subtitle={error ? (error as Error).message : undefined}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 8,
  },
  meta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
