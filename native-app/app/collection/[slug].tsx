import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { collectionBySlug } from "@/lib/discover";
import { usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { EmptyState, Screen } from "@/components/ui";
import type { MarketItem } from "@/app/markets";

// Curated collection — native counterpart of /markets/collections/[slug].
// The symbol list is static; live prices come from the markets API.

export default function CollectionScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const collection = collectionBySlug(slug ?? "");

  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["markets", "all"],
    queryFn: () => api<{ items: MarketItem[] }>("/markets"),
    staleTime: 60_000,
    enabled: !!collection,
  });

  if (!collection) {
    return (
      <Screen>
        <EmptyState title="Collection not found" />
      </Screen>
    );
  }

  const wanted = new Set(collection.symbols);
  const items = (data?.items ?? []).filter((i) => wanted.has(i.symbol));

  return (
    <Screen>
      <Stack.Screen options={{ title: collection.title }} />
      <FlatList
        data={items}
        keyExtractor={(i) => i.symbol}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }}
        refreshing={isRefetching}
        onRefresh={() => void refetch()}
        ListHeaderComponent={
          <LinearGradient
            colors={collection.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <Text style={[type.h2, { fontSize: 22 }]}>{collection.title}</Text>
            <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 13, lineHeight: 18 }}>
              {collection.blurb}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
              {collection.symbols.length} assets
            </Text>
          </LinearGradient>
        }
        renderItem={({ item }) => {
          const up = item.changePct >= 0;
          return (
            <Pressable
              onPress={() => router.push({ pathname: "/market/[symbol]", params: { symbol: item.symbol } })}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.logoStub}>
                <Text style={{ color: colors.neon, fontWeight: "800" }}>{item.symbol.slice(0, 2)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[type.body, { fontWeight: "700" }]}>{item.symbol}</Text>
                <Text style={type.dim} numberOfLines={1}>
                  {item.name}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[type.body, { fontWeight: "700" }]}>{usd(item.price)}</Text>
                <Text style={{ color: up ? colors.neon : colors.accent, fontSize: 13 }}>
                  {up ? "+" : ""}
                  {item.changePct.toFixed(2)}%
                </Text>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            title={isLoading ? "Loading…" : error ? "Couldn't load assets" : "No listed assets"}
            subtitle={error ? (error as Error).message : undefined}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 6,
    marginBottom: spacing.sm,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 },
  logoStub: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.neonSoft,
    alignItems: "center",
    justifyContent: "center",
  },
});
