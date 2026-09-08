import React from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  FurlCard,
  FurlEmptyState,
  FurlErrorState,
  FurlScreen,
  FurlSkeletonList,
  FurlStatusBadge,
  type MoneyStatus,
} from "@/components/furl";
import { useTheme } from "@/lib/design";
import { useI18n } from "@/lib/i18n";
import { useSecureScreen } from "@/lib/secureScreen";
import { useOrders } from "@/lib/p2p/useP2P";
import { isOrderLive, whoseTurn, type P2POrder } from "@/lib/p2p/types";

// ---------------------------------------------------------------------------
// My orders.
//
// SORTED BY WHAT NEEDS THE USER, not by date. An order waiting on them is the
// only row on this screen that carries a consequence — a payment window that
// expires, or a counterparty waiting on a release — and a strict reverse-
// chronological list buries it under settled trades from last week.
//
// Within each group the order is by recency, so the list is still predictable.
// ---------------------------------------------------------------------------

export default function P2POrdersScreen() {
  // Amounts and counterparties across every trade.
  useSecureScreen("p2p-orders");

  const t = useTheme();
  const { t: tr } = useI18n();
  const router = useRouter();
  const orders = useOrders();

  const sorted = React.useMemo(() => rankOrders(orders.data ?? []), [orders.data]);

  return (
    <FurlScreen>
      <ScrollView
        contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.sm }}
        refreshControl={
          <RefreshControl
            refreshing={orders.isRefetching}
            onRefresh={() => void orders.refetch()}
            tintColor={t.colors.primary}
          />
        }
      >
        {orders.isLoading ? (
          <FurlSkeletonList rows={4} />
        ) : orders.error ? (
          <FurlErrorState error={orders.error} onAction={() => void orders.refetch()} actionLabel={tr("state.retry")} />
        ) : sorted.length === 0 ? (
          <FurlEmptyState icon="receipt-outline" title={tr("p2p.noOrders")} body={tr("p2p.noOrdersBody")} />
        ) : (
          sorted.map((order) => (
            <FurlCard
              key={order.id}
              onPress={() => router.push(`/p2p/order/${order.id}`)}
              accessibilityLabel={tr("p2p.orderRef", { sn: order.sn })}
            >
              <View style={{ gap: t.spacing.xs }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.xs }}>
                  <FurlStatusBadge status={statusToBadge(order.status)} compact />
                  <Text style={[t.type("caption"), { color: t.colors.textDim, flex: 1 }]} numberOfLines={1}>
                    {tr("p2p.orderRef", { sn: order.sn })}
                  </Text>
                  {whoseTurn(order) === "you" ? (
                    <Text style={[t.type("caption"), { color: t.colors.primaryText }]}>{tr("p2p.yourTurn")}</Text>
                  ) : null}
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={t.type("body")}>
                    {order.amount} {order.asset}
                  </Text>
                  <Text style={t.type("body")}>
                    {order.fiatAmount} {order.fiat}
                  </Text>
                </View>
              </View>
            </FurlCard>
          ))
        )}
      </ScrollView>
    </FurlScreen>
  );
}

/**
 * Your move first, then live orders, then everything settled.
 *
 * Exported for the test: the ranking is the screen's only real logic, and it is
 * the difference between a user noticing an expiring payment window and not.
 */
export function rankOrders(orders: P2POrder[]): P2POrder[] {
  const rank = (o: P2POrder): number => {
    if (whoseTurn(o) === "you") return 0;
    if (isOrderLive(o.status)) return 1;
    return 2;
  };
  return [...orders].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    // Stable and predictable within a group: most recent first.
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

function statusToBadge(status: P2POrder["status"]): MoneyStatus {
  switch (status) {
    case "pending_payment":
      return "escrow";
    case "paid":
      return "processing";
    case "released":
      return "settled";
    case "cancelled":
      return "cancelled";
    case "appealed":
      return "frozen";
  }
}
