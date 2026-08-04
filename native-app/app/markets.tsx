import React, { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { COLLECTIONS } from "@/lib/discover";
import { usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { EmptyState, Field, Screen, SectionHeader } from "@/components/ui";
import { CollectionsCarousel, MarketPulse, TrendingCarousel, useMovers } from "@/components/Discover";
import { AssetLogo } from "@/components/AssetLogo";
import { GlowSelectionPill } from "@/components/GlowSelectionPill";
import { SearchBar } from "@/components/SearchBar";
import { useDebounced } from "@/lib/useDebounced";

/** Explicit quote state from the API. Clients switch on this instead of
 *  inferring meaning from a null price — `null >= 0` is TRUE in JS, which
 *  rendered unpriced rows as a green "+0.00%" gain on web and in the
 *  extension before this contract existed. */
export type QuoteStatus = "live" | "delayed" | "unavailable";

export interface MarketItem {
  symbol: string;
  name: string;
  kind: "stock" | "etf" | "crypto";
  sector: string | null;
  /** NULLABLE. /api/markets/search spans the full ~13k tradable universe and
   *  uncurated assets arrive unpriced — pricing every symbol per keystroke
   *  would be thousands of provider calls. Render "—", never 0. */
  price: number | null;
  changePct: number | null;
  live: boolean;
  logo: string | null;
  quoteStatus?: QuoteStatus;
  curated?: boolean;
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
  const { kind: initialKind } = useLocalSearchParams<{ kind?: string }>();
  const [kind, setKind] = useState<(typeof KINDS)[number]>(
    KINDS.includes(initialKind as (typeof KINDS)[number]) ? (initialKind as (typeof KINDS)[number]) : "all"
  );
  const [sort, setSort] = useState<string>("-changePct");
  const [query, setQuery] = useState("");
  /* Debounced BEFORE it reaches the query key. Undebounced, every keystroke was
     a request against the ~13k tradable universe, and responses could land out
     of order — "AAP" arriving after "AAPL" and overwriting it. */
  const debouncedQuery = useDebounced(query, 400);

  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["markets", kind, sort, debouncedQuery.trim()],
    queryFn: () => {
      const q = debouncedQuery.trim();
      const params = new URLSearchParams();
      if (kind !== "all") params.set("kind", kind);
      params.set("limit", "80");
      // A query searches the FULL tradable universe (~13k) server-side; the
      // default view keeps the curated catalog, which is the editorially
      // meaningful browse experience.
      if (q) {
        params.set("q", q);
        return api<{ items: MarketItem[] }>(`/markets/search?${params}`);
      }
      params.set("sort", sort);
      return api<{ items: MarketItem[] }>(`/markets?${params}`);
    },
    staleTime: 30_000,
  });
  const items = data?.items ?? [];

  // Discovery sections (pulse, movers, collections) show on the default view
  // only, mirroring the web /markets page.
  /* Follows the LIVE text, not the debounced one: clearing the field should
     bring the curated browse view straight back rather than 400ms later. */
  const discover = kind === "all" && !query.trim();
  const { data: moversData } = useMovers(8);
  const trending = moversData
    ? [...moversData.gainers.slice(0, 5), ...moversData.losers.slice(0, 3)]
    : [];

  return (
    <Screen>
      <View style={{ padding: spacing.md, paddingBottom: 0, gap: spacing.sm }}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder="Search 390+ stocks, ETFs & crypto…"
          namespace="markets"
          /* Shown only until the user has a history of their own. */
          suggestions={["AAPL", "NVDA", "BTC", "Gold", "S&P 500"]}
        />
        <View style={styles.chips}>
          {KINDS.map((k) => (
            <GlowSelectionPill
              key={k}
              label={k === "etf" ? "ETF" : k.charAt(0).toUpperCase() + k.slice(1)}
              selected={kind === k}
              onPress={() => setKind(k)}
            />
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
          <Pressable onPress={() => router.push("/chains")} style={styles.chainsChip}>
            <Ionicons name="link-outline" size={13} color={colors.textDim} />
            <Text style={{ color: colors.textDim, fontWeight: "600", fontSize: 12 }}>Chains</Text>
          </Pressable>
        </View>
      </View>
      <FlatList
        data={items}
        keyExtractor={(i) => i.symbol}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }}
        refreshing={isRefetching}
        onRefresh={() => void refetch()}
        ListHeaderComponent={
          discover ? (
            <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
              <MarketPulse />
              {trending.length ? (
                <>
                  <SectionHeader title="Trending today" />
                  <TrendingCarousel movers={trending} />
                </>
              ) : null}
              <SectionHeader title="Collections" />
              <CollectionsCarousel collections={COLLECTIONS} />
              <SectionHeader title="All assets" />
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          // Explicit null check: `null >= 0` is true in JS, so comparing
          // directly paints unpriced rows green with a fabricated gain.
          const hasQuote =
            item.quoteStatus !== "unavailable" &&
            item.price != null &&
            Number.isFinite(item.price);
          const hasChange = item.changePct != null && Number.isFinite(item.changePct);
          const up = hasChange && (item.changePct as number) >= 0;
          return (
            <Pressable
              onPress={() => router.push({ pathname: "/market/[symbol]", params: { symbol: item.symbol } })}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <AssetLogo symbol={item.symbol} logo={item.logo} size={38} />
              <View style={{ flex: 1 }}>
                <Text style={[type.body, { fontWeight: "700" }]}>{item.symbol}</Text>
                <Text style={type.dim} numberOfLines={1}>
                  {item.name}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[type.body, { fontWeight: "700" }]}>
                  {hasQuote ? usd(item.price as number) : "—"}
                </Text>
                {hasChange ? (
                  <Text style={{ color: up ? colors.neon : colors.accent, fontSize: 13 }}>
                    {up ? "+" : ""}
                    {(item.changePct as number).toFixed(2)}%
                  </Text>
                ) : (
                  // No quote — say so rather than showing a flat "+0.00%".
                  <Text style={{ color: colors.textFaint, fontSize: 12 }}>no quote</Text>
                )}
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
  chainsChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 },
});
