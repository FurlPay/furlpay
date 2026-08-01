import React, { useState } from "react";
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
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { api } from "@/lib/api";
import { useOverview } from "@/lib/queries";
import { usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { EmptyState, Screen, SectionHeader, Sheet, Surface } from "@/components/ui";
import { TransactionRow } from "@/components/TransactionRow";
import { Avatar } from "@/components/Avatar";
import { AccountDrawer } from "@/components/AccountDrawer";
import { BalanceHero } from "@/components/BalanceHero";
import { NotificationBell } from "@/components/NotificationBell";
import { VerifiedBadge } from "@/components/VerifiedBadge";

// Add money — native counterpart of the web dashboard's DepositModal:
// crypto QR, bank transfer details, or card on-ramp.
interface FiatAccount {
  currency: string;
  amount: number;
  usdValue: number;
  localDetails?: Record<string, string>;
}

function DepositRow({
  icon,
  title,
  sub,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.depositRow, pressed && { opacity: 0.7 }]}>
      <View style={styles.depositIcon}>
        <Ionicons name={icon} size={20} color={colors.text} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { fontWeight: "700" }]}>{title}</Text>
        <Text style={[type.dim, { fontSize: 12 }]}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

function AddMoneySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [bankOpen, setBankOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["banking"],
    queryFn: () => api<{ accounts: FiatAccount[] }>("/banking"),
    enabled: open,
  });
  const withDetails = (data?.accounts ?? []).filter((a) => a.localDetails);

  const go = (path: "/receive" | "/banking") => {
    onClose();
    router.push(path);
  };

  return (
    <Sheet open={open} title="Add money" onClose={onClose}>
      <DepositRow
        icon="qr-code-outline"
        title="Deposit crypto"
        sub="Your self-custodial USDC address (Arbitrum)"
        onPress={() => go("/receive")}
      />
      <DepositRow
        icon="business-outline"
        title="Bank transfer"
        sub="Free · arrives in minutes"
        onPress={() => setBankOpen((b) => !b)}
      />
      {bankOpen ? (
        withDetails.length ? (
          withDetails.map((a) => (
            <Surface key={a.currency} style={{ gap: 2 }}>
              <Text style={[type.dim, { fontSize: 11, fontWeight: "700" }]}>{a.currency}</Text>
              {Object.entries(a.localDetails!).map(([k, v]) => (
                <Pressable
                  key={k}
                  onPress={() =>
                    void Clipboard.setStringAsync(v).then(() =>
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    )
                  }
                  style={({ pressed }) => [styles.bankRow, pressed && { opacity: 0.6 }]}
                >
                  <Text style={[type.dim, { fontSize: 12, textTransform: "capitalize" }]}>
                    {k.replace(/([A-Z])/g, " $1")}
                  </Text>
                  <Text style={[type.mono, { fontSize: 12, color: colors.text }]}>{v}</Text>
                </Pressable>
              ))}
            </Surface>
          ))
        ) : (
          <Text style={[type.dim, { paddingHorizontal: 4 }]}>
            No bank details yet — open a local account under Banking first.
          </Text>
        )
      ) : null}
      <DepositRow
        icon="add-outline"
        title="Buy with card"
        sub="Visa / Mastercard on-ramp"
        onPress={() => go("/banking")}
      />
    </Sheet>
  );
}

/** Route accepted by the typed router (app.json sets experiments.typedRoutes). */
type Route = Parameters<ReturnType<typeof useRouter>["push"]>[0];

// A dashboard tile: rounded-square container, circular mint icon, small label.
// The container is what turns eight loose icons into a grid the eye reads as
// one block — and it roughly doubles the touch target, which on the row a user
// reaches for one-handed is the part that actually matters.
//
// It takes a ROUTE, not an onPress. An inline `() => router.push(…)` is a new
// function on every render, so a memoized tile taking a callback would re-render
// with the parent anyway — memo with an unstable prop is worse than no memo,
// because it adds a comparison that can never succeed. With primitives only,
// the eight tiles render once and stay put through every balance refetch.
const QuickAction = React.memo(function QuickAction({
  icon,
  label,
  to,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  to: Route;
}) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        router.push(to);
      }}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={20} color={colors.neon} />
      </View>
      <Text style={styles.actionLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
});

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function Home() {
  const router = useRouter();
  const [addMoneyOpen, setAddMoneyOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
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
        {/* Avatar + greeting — tapping the avatar opens the account drawer */}
        <View style={styles.header}>
          <Pressable
            onPress={() => setDrawerOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Open account menu"
          >
            <Avatar name={overview?.user.name} size={46} ring />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={type.dim}>{greeting()}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text
                style={[type.h2, { letterSpacing: -0.3, flexShrink: 1 }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {firstName ?? "there"}
              </Text>
              {overview ? <VerifiedBadge verified={overview.user.kycStatus === "verified"} size={18} /> : null}
            </View>
          </View>
          <Pressable
            onPress={() => router.push("/chat")}
            hitSlop={8}
            style={styles.headerIcon}
            accessibilityRole="button"
            accessibilityLabel="Open AI co-pilot"
          >
            <Ionicons name="sparkles-outline" size={20} color={colors.neon} />
          </Pressable>
          {/* The unread dot is the only thing on this screen that reports state
              the user has not already seen, so it sits next to the avatar. */}
          <NotificationBell onPress={() => router.push("/notifications")} />
          <Pressable
            onPress={() => router.push("/scan")}
            hitSlop={8}
            style={styles.headerIcon}
            accessibilityRole="button"
            accessibilityLabel="Scan to pay"
          >
            <Ionicons name="scan-outline" size={20} color={colors.text} />
          </Pressable>
        </View>

        {/* Balance hero. Add-money moved off the header and onto the card,
            next to the balance it changes — and the header lost an icon. */}
        <BalanceHero
          overview={overview}
          loading={isLoading}
          cachedAt={result?.fromCache ? result.updatedAt : undefined}
          onAddMoney={() => setAddMoneyOpen(true)}
        />

        {/* Quick actions — 8 tiles. Scan is not among them: it has a dedicated
            header button and the QR flow is reached from there, so the slot
            goes to Rewards, which previously had no entry point outside
            Settings → Rewards & referrals. */}
        <View style={styles.actions}>
          <QuickAction icon="paper-plane-outline" label="Send" to="/(tabs)/send" />
          <QuickAction icon="download-outline" label="Receive" to="/receive" />
          <QuickAction icon="repeat-outline" label="Swap" to="/swap" />
          <QuickAction icon="gift-outline" label="Rewards" to="/rewards" />
        </View>
        <View style={styles.actions}>
          <QuickAction icon="leaf-outline" label="Earn" to="/earn" />
          <QuickAction icon="receipt-outline" label="Bills" to="/bills" />
          <QuickAction icon="cash-outline" label="Credit" to="/credit" />
          <QuickAction icon="airplane-outline" label="Travel" to="/travel" />
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
      <AddMoneySheet open={addMoneyOpen} onClose={() => setAddMoneyOpen(false)} />
      <AccountDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: { flexDirection: "row", gap: spacing.sm },
  action: {
    flex: 1,
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  actionPressed: { backgroundColor: colors.surfaceRaised, borderColor: colors.neon },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.neonSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: { color: colors.textDim, fontSize: 11, fontWeight: "600" },
  balanceCard: { width: 170, gap: 4 },
  depositRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  depositIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  bankRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 6,
  },
});
