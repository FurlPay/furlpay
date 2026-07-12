import React from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Link, useRouter } from "expo-router";
import { useOverview } from "@/lib/queries";
import { timeAgo, usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { EmptyState, Screen, SectionHeader, Surface } from "@/components/ui";
import { TransactionRow } from "@/components/TransactionRow";

function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}>
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={20} color={colors.neon} />
      </View>
      <Text style={type.dim}>{label}</Text>
    </Pressable>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function Home() {
  const router = useRouter();
  const { data: result, isLoading, refetch, isRefetching, error } = useOverview();
  const overview = result?.data;
  const firstName = overview?.user.name?.split(" ")[0];

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.neon} />
        }
      >
        {/* Avatar + greeting */}
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarLetter}>{(firstName?.[0] ?? "F").toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={type.dim}>{greeting()}</Text>
            <Text style={[type.h2, { letterSpacing: -0.3 }]}>{firstName ?? "there"}</Text>
          </View>
          <Pressable onPress={() => router.push("/scan")} hitSlop={8} style={styles.headerIcon}>
            <Ionicons name="scan-outline" size={20} color={colors.text} />
          </Pressable>
        </View>

        {/* Net worth */}
        <View style={{ gap: 4 }}>
          <Text style={type.dim}>
            Net worth
            {result?.fromCache ? `  ·  cached ${timeAgo(result.updatedAt)}` : ""}
          </Text>
          <Text style={styles.netWorth}>
            {overview ? usd(overview.netWorth) : isLoading ? "· · ·" : "—"}
          </Text>
          {overview ? (
            <Text style={type.dim}>
              Crypto {usd(overview.breakdown.crypto)} · Fiat {usd(overview.breakdown.fiat)} · Stocks{" "}
              {usd(overview.breakdown.equities)}
            </Text>
          ) : null}
        </View>

        {/* Quick actions */}
        <View style={styles.actions}>
          <QuickAction icon="paper-plane-outline" label="Send" onPress={() => router.push("/(tabs)/send")} />
          <QuickAction icon="download-outline" label="Receive" onPress={() => router.push("/receive")} />
          <QuickAction icon="scan-outline" label="Scan" onPress={() => router.push("/scan")} />
          <QuickAction icon="card-outline" label="Cards" onPress={() => router.push("/(tabs)/cards")} />
        </View>

        {/* Balances */}
        <SectionHeader title="Balances" />
        {overview && overview.tokenBalances.length + overview.fiatBalances.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {overview.tokenBalances.map((b) => (
              <Surface key={`${b.token}-${b.chain}`} style={styles.balanceCard}>
                <Text style={[type.body, { fontWeight: "700" }]}>{b.token}</Text>
                <Text style={type.dim}>{b.chain}</Text>
                <Text style={[type.h2, { color: colors.neon }]}>{usd(b.usdValue)}</Text>
                <Text style={type.dim}>
                  {b.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} {b.token}
                </Text>
              </Surface>
            ))}
            {overview.fiatBalances.map((b) => (
              <Surface key={b.currency} style={styles.balanceCard}>
                <Text style={[type.body, { fontWeight: "700" }]}>{b.currency}</Text>
                <Text style={type.dim}>fiat</Text>
                <Text style={[type.h2, { color: colors.text }]}>{usd(b.usdValue)}</Text>
                <Text style={type.dim}>
                  {b.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} {b.currency}
                </Text>
              </Surface>
            ))}
          </ScrollView>
        ) : (
          <EmptyState
            title={error ? "Couldn't load balances" : isLoading ? "Loading…" : "No balances yet"}
            subtitle={error ? (error as Error).message : undefined}
          />
        )}

        {/* Recent activity */}
        <SectionHeader
          title="Recent activity"
          right={
            <Link href="/transactions" asChild>
              <Pressable hitSlop={8}>
                <Text style={{ color: colors.neon, fontWeight: "600" }}>See all</Text>
              </Pressable>
            </Link>
          }
        />
        <Surface style={{ paddingVertical: 4 }}>
          {overview?.recentTransactions.length ? (
            overview.recentTransactions.map((tx) => <TransactionRow key={tx.id} tx={tx} />)
          ) : (
            <EmptyState title="No transactions yet" subtitle="Payments you send and receive show up here." />
          )}
        </Surface>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.neonSoft,
    borderColor: colors.neonDeep,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    // Neon glow (Android renders elevation; iOS the shadow*)
    elevation: 8,
    shadowColor: colors.neon,
    shadowOpacity: 0.6,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  avatarLetter: { color: colors.neon, fontSize: 20, fontWeight: "800" },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  netWorth: { fontSize: 40, fontWeight: "800", color: colors.text, letterSpacing: -1 },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  action: { alignItems: "center", gap: 6, flex: 1 },
  actionIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.neonSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  balanceCard: { width: 170, gap: 4 },
});
