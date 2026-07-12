import React, { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { api } from "@/lib/api";
import { usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { EmptyState, Field, Screen } from "@/components/ui";

export interface MarketItem {
  symbol: string;
  name: string;
  kind: "stock" | "etf" | "crypto";
  sector: string | null;
  price: number;
  changePct: number;
  live: boolean;
}

const KINDS = ["all", "stock", "etf", "crypto"] as const;
const SORTS = [
  { key: "-changePct", label: "Top movers" },
  { key: "changePct", label: "Losers" },
  { key: "symbol", label: "A–Z" },
  { key: "-price", label: "Price" },
] as const;

export default function Markets() {
  const router = useRouter();
  const [kind, setKind] = useState<(typeof KINDS)[number]>("all");
  const [sort, setSort] = useState<string>("-changePct");
  const [query, setQuery] = useState("");

  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["markets", kind, sort, query.trim()],
    queryFn: () => {
      const params = new URLSearchParams();
      if (kind !== "all") params.set("kind", kind);
      params.set("sort", sort);
      if (query.trim()) params.set("q", query.trim());
      params.set("limit", "80");
      return api<{ items: MarketItem[] }>(`/markets?${params}`);
    },
    staleTime: 30_000,
  });
  const items = data?.items ?? [];

  return (
    <Screen>
      <View style={{ padding: spacing.md, paddingBottom: 0, gap: spacing.sm }}>
        <Field
          value={query}
          onChangeText={setQuery}
          placeholder="Search 390+ stocks, ETFs & crypto…"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={styles.chips}>
          {KINDS.map((k) => (
            <Pressable
              key={k}
              onPress={() => setKind(k)}
              style={[styles.chip, kind === k && { backgroundColor: colors.neon }]}
            >
              <Text
                style={{
                  color: kind === k ? colors.onNeon : colors.textDim,
                  fontWeight: "600",
                  textTransform: "capitalize",
                }}
              >
                {k}
              </Text>
            </Pressable>
          ))}
          <View style={{ flex: 1 }} />
          {SORTS.map((s) => (
            <Pressable key={s.key} onPress={() => setSort(s.key)}>
              <Text
                style={{
                  color: sort === s.key ? colors.neon : colors.textFaint,
                  fontWeight: "600",
                  fontSize: 12,
                }}
              >
                {s.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <FlatList
        data={items}
        keyExtractor={(i) => i.symbol}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }}
        refreshing={isRefetching}
        onRefresh={() => void refetch()}
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
            title={isLoading ? "Loading…" : error ? "Couldn't load markets" : "No matches"}
            subtitle={error ? (error as Error).message : undefined}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  chip: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
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
