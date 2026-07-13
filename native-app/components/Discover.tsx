import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import type { Collection } from "@/lib/discover";

// ---------------------------------------------------------------------------
// Market discovery building blocks shared by the Invest tab and the Markets
// screen — mirrors the web's MarketIndices, movers carousel and CollectionCard.
// ---------------------------------------------------------------------------

interface IndexItem {
  id: string;
  label: string;
  proxy: string;
  price: number;
  changePct: number;
  live: boolean;
}

export interface Mover {
  symbol: string;
  name: string;
  logo: string | null;
  price: number;
  changePct: number;
}

export function useIndices() {
  return useQuery({
    queryKey: ["market-indices"],
    queryFn: () => api<{ items: IndexItem[]; sentiment: number }>("/markets/indices"),
    staleTime: 60_000,
  });
}

export function useMovers(limit: number) {
  return useQuery({
    queryKey: ["market-movers", limit],
    queryFn: () => api<{ gainers: Mover[]; losers: Mover[] }>(`/markets/movers?limit=${limit}`),
    staleTime: 60_000,
  });
}

function fmtPrice(p: number): string {
  if (p >= 1000) return usd(Math.round(p));
  if (p >= 1) return usd(p);
  return `$${p.toPrecision(3)}`;
}

/** Market pulse — index proxies as a horizontal strip. */
export function MarketPulse() {
  const { data } = useIndices();
  if (!data?.items.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
      {data.items.map((ix) => {
        const up = ix.changePct >= 0;
        return (
          <View key={ix.id} style={styles.pulseCard}>
            <Text style={[type.dim, { fontSize: 11 }]}>{ix.label}</Text>
            <Text style={[type.body, { fontWeight: "700" }]}>{fmtPrice(ix.price)}</Text>
            <Text style={{ color: up ? colors.neon : colors.accent, fontSize: 12, fontWeight: "600" }}>
              {up ? "+" : ""}
              {ix.changePct.toFixed(2)}%
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

/** Trending today — top movers as tappable cards. */
export function TrendingCarousel({ movers }: { movers: Mover[] }) {
  const router = useRouter();
  if (!movers.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
      {movers.map((m) => {
        const up = m.changePct >= 0;
        return (
          <Pressable
            key={m.symbol}
            onPress={() => router.push({ pathname: "/market/[symbol]", params: { symbol: m.symbol } })}
            style={({ pressed }) => [styles.moverCard, pressed && { opacity: 0.7 }]}
          >
            <View style={styles.logoStub}>
              <Text style={{ color: colors.neon, fontWeight: "800", fontSize: 12 }}>
                {m.symbol.slice(0, 2)}
              </Text>
            </View>
            <Text style={[type.body, { fontWeight: "700", fontSize: 13 }]} numberOfLines={1}>
              {m.symbol}
            </Text>
            <Text style={[type.dim, { fontSize: 11 }]} numberOfLines={1}>
              {fmtPrice(m.price)}
            </Text>
            <Text style={{ color: up ? colors.neon : colors.accent, fontSize: 12, fontWeight: "600" }}>
              {up ? "+" : ""}
              {m.changePct.toFixed(2)}%
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Curated collection cards — gradient tiles linking to the collection screen. */
export function CollectionsCarousel({ collections }: { collections: Collection[] }) {
  const router = useRouter();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
      {collections.map((c) => (
        <Pressable
          key={c.slug}
          onPress={() => router.push({ pathname: "/collection/[slug]", params: { slug: c.slug } })}
          style={({ pressed }) => pressed && { opacity: 0.8 }}
        >
          <LinearGradient
            colors={c.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.collectionCard}
          >
            <Text style={[type.body, { fontWeight: "800", fontSize: 15 }]} numberOfLines={2}>
              {c.title}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 11 }}>
              {c.symbols.length} assets
            </Text>
          </LinearGradient>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pulseCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 2,
    minWidth: 108,
  },
  moverCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 12,
    gap: 3,
    width: 112,
  },
  logoStub: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.neonSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  collectionCard: {
    width: 150,
    height: 96,
    borderRadius: radius.md,
    padding: 12,
    justifyContent: "space-between",
  },
});
