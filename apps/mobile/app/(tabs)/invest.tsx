import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { usePortfolio } from "@/lib/queries";
import { usd } from "@/lib/format";
import { colors, spacing, type } from "@/lib/theme";
import { EmptyState, Screen, SectionHeader, Surface } from "@/components/ui";

function NavTile({
  icon,
  label,
  sub,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={20} color={colors.neon} />
      <Text style={[type.body, { fontWeight: "700" }]}>{label}</Text>
      <Text style={[type.dim, { fontSize: 12 }]}>{sub}</Text>
    </Pressable>
  );
}

export default function Invest() {
  const router = useRouter();
  const { data: result, isLoading, refetch, isRefetching, error } = usePortfolio();
  const portfolio = result?.data;

  const perf = portfolio?.performance;
  const up = (perf?.dayChange ?? 0) >= 0;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.neon} />
        }
      >
        <View style={{ gap: 4 }}>
          <Text style={type.dim}>Portfolio value</Text>
          <Text style={styles.value}>{perf ? usd(perf.marketValue) : isLoading ? "· · ·" : "—"}</Text>
          {perf ? (
            <Text style={{ color: up ? colors.neon : colors.accent, fontWeight: "600" }}>
              {up ? "▲" : "▼"} {usd(Math.abs(perf.dayChange))} ({perf.dayChangePct.toFixed(2)}%) today
            </Text>
          ) : null}
          {perf ? (
            <Text style={type.dim}>
              Total return {usd(perf.totalReturn, { sign: true })} ({perf.totalReturnPct.toFixed(1)}%)
            </Text>
          ) : null}
        </View>

        <View style={styles.tiles}>
          <NavTile
            icon="search-outline"
            label="Markets"
            sub="390+ stocks, ETFs & crypto"
            onPress={() => router.push("/markets")}
          />
          <NavTile
            icon="leaf-outline"
            label="Earn"
            sub="Curated DeFi vaults"
            onPress={() => router.push("/earn")}
          />
          <NavTile
            icon="newspaper-outline"
            label="Research"
            sub="FurlPay insights"
            onPress={() => router.push("/insights")}
          />
        </View>

        <SectionHeader title="Holdings" />
        {portfolio?.holdings.length ? (
          <Surface style={{ paddingVertical: 4 }}>
            {portfolio.holdings.map((h) => {
              const hUp = h.changePct >= 0;
              return (
                <View key={h.symbol} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.body, { fontWeight: "700" }]}>{h.symbol}</Text>
                    <Text style={type.dim} numberOfLines={1}>
                      {h.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })} shares · {h.name}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[type.body, { fontWeight: "700" }]}>{usd(h.marketValue)}</Text>
                    <Text style={{ color: hUp ? colors.neon : colors.accent, fontSize: 13 }}>
                      {hUp ? "+" : ""}
                      {h.changePct.toFixed(2)}%
                    </Text>
                  </View>
                </View>
              );
            })}
          </Surface>
        ) : (
          <EmptyState
            title={isLoading ? "Loading…" : error ? "Couldn't load portfolio" : "No holdings yet"}
            subtitle={error ? (error as Error).message : "Buy fractional stocks & ETFs from the web dashboard."}
          />
        )}

        {portfolio?.dividends.length ? (
          <>
            <SectionHeader title="Dividends" />
            <Surface style={{ paddingVertical: 4 }}>
              {portfolio.dividends.map((d, i) => (
                <View key={`${d.symbol}-${i}`} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={type.body}>{d.symbol}</Text>
                    <Text style={type.dim}>ex-date {d.exDate}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[type.body, { fontWeight: "700" }]}>{usd(d.amount)}</Text>
                    <Text style={type.dim}>{d.status}</Text>
                  </View>
                </View>
              ))}
            </Surface>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  value: { fontSize: 40, fontWeight: "800", color: colors.text, letterSpacing: -1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  tiles: { flexDirection: "row", gap: spacing.sm },
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: spacing.sm,
    gap: 4,
  },
});
