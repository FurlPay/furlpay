import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { CHAINS, type ChainInfo, type Tier } from "@/lib/discover";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Screen } from "@/components/ui";

// Blockchain networks explorer — native counterpart of /markets/chains.
// Each card links to the native token's market page.

const TIER_LABEL: Record<Tier, string> = { high: "High", medium: "Medium", emerging: "Emerging" };
const TIER_COLOR: Record<Tier, string> = { high: colors.neon, medium: colors.warning, emerging: colors.textFaint };
const CATEGORIES = ["L1", "L2", "Sidechain", "Appchain"] as const;

function TierPill({ label, tier }: { label: string; tier: Tier }) {
  return (
    <View style={styles.pill}>
      <View style={[styles.dot, { backgroundColor: TIER_COLOR[tier] }]} />
      <Text style={styles.pillText}>
        {label} {TIER_LABEL[tier]}
      </Text>
    </View>
  );
}

function ChainCard({ chain }: { chain: ChainInfo }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/market/[symbol]", params: { symbol: chain.token } })}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.cardHead}>
        <View style={styles.logoStub}>
          <Text style={{ color: colors.neon, fontWeight: "800", fontSize: 11 }}>
            {chain.token.slice(0, 3)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[type.body, { fontWeight: "700" }]} numberOfLines={1}>
            {chain.name}
          </Text>
          <Text style={[type.dim, { fontSize: 11 }]}>
            {chain.token} · {chain.launched}
          </Text>
        </View>
      </View>
      <Text style={[type.dim, { fontSize: 11, lineHeight: 15 }]} numberOfLines={3}>
        {chain.blurb}
      </Text>
      <View style={styles.pills}>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{chain.consensus}</Text>
        </View>
        <TierPill label="TVL" tier={chain.tvlTier} />
        <TierPill label="Ecosystem" tier={chain.ecosystemTier} />
      </View>
    </Pressable>
  );
}

export default function Chains() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={type.dim}>{CHAINS.length} major public chains</Text>
        {CATEGORIES.map((cat) => {
          const list = CHAINS.filter((c) => c.category === cat);
          if (!list.length) return null;
          return (
            <View key={cat} style={{ gap: spacing.sm }}>
              <Text style={type.h2}>
                {cat === "L1" ? "Layer 1" : cat === "L2" ? "Layer 2" : cat}{" "}
                <Text style={type.dim}>· {list.length}</Text>
              </Text>
              <View style={styles.grid}>
                {list.map((c) => (
                  <ChainCard key={c.id} chain={c} />
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  card: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 12,
    gap: 8,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  logoStub: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.neonSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pillText: { color: colors.textDim, fontSize: 9.5, fontWeight: "600" },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
