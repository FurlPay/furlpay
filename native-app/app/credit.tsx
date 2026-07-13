import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { EmptyState, Screen, SectionHeader, Surface } from "@/components/ui";

interface Credit {
  apr: number;
  totalCollateral: number;
  borrowingPower: number;
  drawn: number;
  available: number;
  utilizationPct: number;
  currentLtvPct: number;
  maxLtvPct: number;
  healthFactor: number | null;
  monthlyInterest: number;
  collateral: { label: string; kind: "stablecoin" | "crypto" | "equity"; value: number; ltv: number; borrowable: number }[];
}

const KIND_LABEL = { stablecoin: "Stablecoin", crypto: "Crypto", equity: "Equities" } as const;

function healthColor(h: number | null): string {
  if (h === null) return colors.textDim;
  if (h >= 1.5) return colors.neon;
  if (h >= 1.1) return colors.warning;
  return colors.accent;
}

export default function CreditScreen() {
  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["credit"],
    queryFn: () => api<Credit>("/credit"),
  });

  if (!data) {
    return (
      <Screen>
        <EmptyState
          title={isLoading ? "Loading…" : "Couldn't load credit line"}
          subtitle={error ? (error as Error).message : undefined}
        />
      </Screen>
    );
  }

  const hf = data.healthFactor;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.neon} />
        }
      >
        <View style={{ gap: 4 }}>
          <Text style={type.dim}>Available to borrow</Text>
          <Text style={styles.hero}>{usd(data.available)}</Text>
          <Text style={type.dim}>
            {data.apr}% APR · interest only on drawn funds · borrowing is not a taxable event
          </Text>
        </View>

        <Surface style={{ gap: spacing.sm }}>
          <View style={styles.row}>
            <Text style={type.dim}>Drawn</Text>
            <Text style={[type.body, { fontWeight: "700" }]}>{usd(data.drawn)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={type.dim}>Utilization</Text>
            <Text style={type.body}>{data.utilizationPct}%</Text>
          </View>
          <View style={styles.meter}>
            <View
              style={[
                styles.meterFill,
                {
                  width: `${Math.min(100, data.utilizationPct)}%`,
                  backgroundColor: data.utilizationPct > 80 ? colors.accent : colors.neon,
                },
              ]}
            />
          </View>
          <View style={styles.row}>
            <Text style={type.dim}>
              LTV {data.currentLtvPct}% / liquidation at {data.maxLtvPct}%
            </Text>
            <Text style={type.dim}>{usd(data.monthlyInterest)}/mo interest</Text>
          </View>
          <View style={styles.row}>
            <Text style={type.dim}>Health factor</Text>
            <Text style={{ color: healthColor(hf), fontWeight: "800", fontSize: 16 }}>
              {hf === null ? "—" : hf.toFixed(2)}
            </Text>
          </View>
          {hf !== null && hf < 1.5 ? (
            <Text style={{ color: healthColor(hf), fontSize: 13 }}>
              {hf < 1.1
                ? "At risk of liquidation — repay or add collateral now."
                : "Getting close to the liquidation threshold — consider repaying."}
            </Text>
          ) : null}
        </Surface>

        <SectionHeader title="Collateral" />
        <Surface style={{ paddingVertical: 4 }}>
          {data.collateral.map((c) => (
            <View key={c.label} style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Text style={type.body}>{c.label}</Text>
                <Text style={type.dim}>
                  {KIND_LABEL[c.kind]} · {Math.round(c.ltv * 100)}% LTV
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[type.body, { fontWeight: "700" }]}>{usd(c.value)}</Text>
                <Text style={type.dim}>borrow {usd(c.borrowable)}</Text>
              </View>
            </View>
          ))}
        </Surface>

        <Text style={[type.dim, { color: colors.textFaint }]}>
          Draw and repay from the web dashboard. Portfolio-backed credit uses your stablecoins, crypto
          and equities as collateral, each discounted by its asset-class LTV.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  hero: { fontSize: 36, fontWeight: "800", color: colors.text, letterSpacing: -1 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  row2: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  meter: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, overflow: "hidden" },
  meterFill: { height: "100%" },
});
