import React, { useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { api, ApiError } from "@/lib/api";
import { authorizeMoneyMove } from "@/lib/money/authorize";
import { usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, EmptyState, ErrorNote, Field, Screen, SectionHeader, Surface } from "@/components/ui";
import { PriceChart } from "@/components/PriceChart";
import { AssetLogo } from "@/components/AssetLogo";
import {
  describeOrderOutcome,
  ORDER_TICKET_TYPES,
  type OrderTicketType,
} from "@/lib/markets/orderTicket";

interface AssetDetail {
  asset: { symbol: string; name: string; kind: "stock" | "etf" | "crypto"; sector: string | null; logo: string | null };
  quote: { price: number; changePct: number; live: boolean };
  stats: Record<string, string | number | null>;
  digest: string;
  position: { shares: number; marketValue: number } | null;
  related: { symbol: string; name: string; price: number; changePct: number }[];
  insights: { slug: string; title: string; signal: string | null; readMins: number }[];
}

export default function MarketDetail() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["market", symbol],
    queryFn: () => api<AssetDetail>(`/markets/${symbol}`),
    enabled: !!symbol,
  });

  const [notional, setNotional] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [busy, setBusy] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);

  // Order type. This screen previously sent no `type` at all, so the route's
  // `market` default applied and a price-contingent order was unreachable from
  // mobile — even though the API has accepted limit/stop/stop_limit since it was
  // written, and now accepts trailing_stop too.
  const [orderType, setOrderType] = useState<OrderTicketType>("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [trailPercent, setTrailPercent] = useState("");

  const needsLimit = orderType === "limit" || orderType === "stop_limit";
  const needsStop = orderType === "stop" || orderType === "stop_limit";
  const needsTrail = orderType === "trailing_stop";
  // A resting order that dies at the close is not what setting a price asks for,
  // and for a trailing stop the adapter refuses `day` outright because it would
  // remove the protection overnight.
  const timeInForce = orderType === "market" ? "day" : "gtc";

  // One Idempotency-Key per order INTENT, not per tap. A timeout followed by a
  // re-tap must replay the same order, never place a second one — so the key
  // survives network failures, and rotates only when the intent changes
  // (amount/side edited) or the server has actually answered: a fill consumes
  // it, a rejection ends it, and the next attempt is a new order either way.
  const orderKey = useRef<string | null>(null);
  useEffect(() => {
    orderKey.current = null;
    // Every field below is part of the INTENT, so editing any of them makes the
    // previous key describe an order the user no longer wants. Missing one would
    // be the worse failure: a retry after changing the limit price would replay
    // the ORIGINAL order at the original price, because the key is what the
    // server matches on.
  }, [notional, side, orderType, limitPrice, stopPrice, trailPercent]);

  const placeOrder = async () => {
    const amt = Number(notional);
    if (!(amt > 0) || !data) return;
    setOrderError(null);
    const decision = await authorizeMoneyMove({
      action: "send_funds",
      amountUsd: amt,
      reason: `${side === "buy" ? "Buy" : "Sell"} ${usd(amt)} of ${data.asset.symbol} — about ${(amt / data.quote.price).toFixed(4)} shares at ${usd(data.quote.price)}`,
    });
    if (!decision.ok) {
      if (decision.kind !== "declined") setOrderError(decision.message);
      return;
    }
    setBusy(true);
    orderKey.current ??= crypto.randomUUID();
    try {
      const res = await api<{ orderId: string; status: string; filledQty: number }>("/investing/order", {
        method: "POST",
        headers: { "Idempotency-Key": orderKey.current },
        body: {
          symbol: data.asset.symbol,
          side,
          notional: amt,
          type: orderType,
          time_in_force: timeInForce,
          ...(needsLimit ? { limit_price: Number(limitPrice) } : {}),
          ...(needsStop ? { stop_price: Number(stopPrice) } : {}),
          ...(needsTrail ? { trail_percent: Number(trailPercent) } : {}),
        },
      });
      orderKey.current = null;
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // The provider's own status, mapped. A resting limit order and an
      // unconfirmed submission both used to read as "Placed", and they need
      // opposite things from the user: leave the first alone, check the second
      // before placing another or the position may double.
      const outcome = describeOrderOutcome(res.status);
      setPlaced(
        res.status === "filled" || res.status === "partially_filled"
          ? `${outcome.title} — ${res.filledQty.toFixed(4)} shares`
          : `${outcome.title} — ${outcome.detail}`
      );
      setNotional("");
      await qc.invalidateQueries({ queryKey: ["portfolio"] });
      await qc.invalidateQueries({ queryKey: ["market", symbol] });
    } catch (e) {
      // A server rejection is final — the next attempt is a new order, so the
      // key rotates. A network failure means the server may or may not have
      // seen it, which is exactly when the key must be kept: the re-tap
      // replays instead of double-buying.
      if (e instanceof ApiError) orderKey.current = null;
      setOrderError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: String(symbol ?? "") }} />
        <EmptyState
          title={isLoading ? "Loading…" : "Couldn't load asset"}
          subtitle={error ? (error as Error).message : undefined}
        />
      </Screen>
    );
  }

  const up = data.quote.changePct >= 0;
  const tradable = data.asset.kind !== "crypto";

  return (
    <Screen>
      <Stack.Screen options={{ title: data.asset.symbol }} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.neon} />
        }
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <AssetLogo symbol={data.asset.symbol} logo={data.asset.logo} size={48} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={type.dim} numberOfLines={1}>{data.asset.name}</Text>
            <Text style={styles.hero}>{usd(data.quote.price)}</Text>
            <Text style={{ color: up ? colors.neon : colors.accent, fontWeight: "700" }}>
              {up ? "▲" : "▼"} {Math.abs(data.quote.changePct).toFixed(2)}% today
              {data.quote.live ? "" : " · delayed"}
            </Text>
          </View>
        </View>

        <PriceChart symbol={data.asset.symbol} />

        {data.position ? (
          <Surface style={{ gap: 2 }}>
            <Text style={type.dim}>Your position</Text>
            <Text style={type.body}>
              {data.position.shares.toFixed(4)} shares · {usd(data.position.marketValue)}
            </Text>
          </Surface>
        ) : null}

        {tradable ? (
          <Surface style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              {(["buy", "sell"] as const).map((s) => (
                <Button
                  key={s}
                  title={s === "buy" ? "Buy" : "Sell"}
                  variant={side === s ? (s === "sell" ? "danger" : "primary") : "secondary"}
                  onPress={() => setSide(s)}
                  style={{ flex: 1, paddingVertical: 10 }}
                />
              ))}
            </View>
            {/* Order type. `market` stays the default — the common case should
                not require a decision — but the price-contingent types are no
                longer unreachable from mobile. Horizontally scrollable so five
                options fit a narrow screen without shrinking the tap targets. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ flexDirection: "row", gap: spacing.xs }}
            >
              {ORDER_TICKET_TYPES.map((t) => (
                <Button
                  key={t.value}
                  title={t.label}
                  variant={orderType === t.value ? "primary" : "secondary"}
                  // No key reset here: the effect above already rotates it on
                  // any intent change, including orderType. Doing it in both
                  // places would invite the two from drifting apart.
                  onPress={() => setOrderType(t.value)}
                  style={{ paddingVertical: 8, paddingHorizontal: 14 }}
                />
              ))}
            </ScrollView>

            <Field
              label="Amount (USD, fractional)"
              value={notional}
              onChangeText={setNotional}
              keyboardType="decimal-pad"
              placeholder="25.00"
            />

            {needsLimit ? (
              <Field
                label="Limit price — fills here or better"
                value={limitPrice}
                onChangeText={setLimitPrice}
                keyboardType="decimal-pad"
                placeholder={data.quote.price.toFixed(2)}
              />
            ) : null}

            {needsStop ? (
              <Field
                label={`Stop price — becomes a ${orderType === "stop_limit" ? "limit" : "market"} order when touched`}
                value={stopPrice}
                onChangeText={setStopPrice}
                keyboardType="decimal-pad"
                placeholder={data.quote.price.toFixed(2)}
              />
            ) : null}

            {needsTrail ? (
              <>
                <Field
                  label="Trail (% from the high-water mark)"
                  value={trailPercent}
                  onChangeText={setTrailPercent}
                  keyboardType="decimal-pad"
                  placeholder="5"
                />
                {/* The name suggests a guarantee it does not give. */}
                <Text style={type.dim}>
                  The trail moves the trigger, not the fill price — a gap can fill below it.
                </Text>
              </>
            ) : null}
            {/* Order preview — what the confirmation is actually confirming.
                Every line reflects what /investing/order will do: a market
                order filled at the latest quote, no commission, and shares
                derived as amount ÷ price. "Estimated" is honest, not hedging:
                the quote can move between preview and fill. */}
            {Number(notional) > 0 && data.quote.price > 0 ? (
              <View style={styles.preview}>
                <View style={styles.previewRow}>
                  <Text style={type.dim}>Est. shares</Text>
                  <Text style={type.body}>
                    {(Number(notional) / data.quote.price).toFixed(4)}
                  </Text>
                </View>
                <View style={styles.previewRow}>
                  <Text style={type.dim}>At quote</Text>
                  <Text style={type.body}>
                    {usd(data.quote.price)}
                    {data.quote.live ? "" : " (delayed)"}
                  </Text>
                </View>
                <View style={styles.previewRow}>
                  <Text style={type.dim}>Commission</Text>
                  <Text style={type.body}>{usd(0)}</Text>
                </View>
                <Text style={[type.dim, { color: colors.textFaint, fontSize: 12 }]}>
                  Market order — fills at the latest quote, which may differ from
                  the estimate above. Investing involves risk of loss.
                </Text>
              </View>
            ) : null}
            <Button
              title={`${side === "buy" ? "Buy" : "Sell"} ${data.asset.symbol}`}
              loading={busy}
              disabled={
                !(Number(notional) > 0) ||
                (needsLimit && !(Number(limitPrice) > 0)) ||
                (needsStop && !(Number(stopPrice) > 0)) ||
                (needsTrail && !(Number(trailPercent) > 0))
              }
              onPress={() => void placeOrder()}
            />
            {placed ? <Text style={{ color: colors.neon }}>{placed}</Text> : null}
            <ErrorNote message={orderError} />
          </Surface>
        ) : (
          <Text style={type.dim}>Crypto assets trade via Swap — stocks & ETFs order here.</Text>
        )}

        <SectionHeader title="AI digest" />
        <Surface>
          <Text style={[type.body, { lineHeight: 22 }]}>{data.digest}</Text>
        </Surface>

        <SectionHeader title="Key stats" />
        <Surface style={{ paddingVertical: 4 }}>
          {Object.entries(data.stats)
            .filter(([, v]) => v !== null && v !== "")
            .map(([k, v]) => (
              <View key={k} style={styles.row}>
                <Text style={type.dim}>{k}</Text>
                <Text style={type.body}>{String(v)}</Text>
              </View>
            ))}
        </Surface>

        {data.related.length > 0 ? (
          <>
            <SectionHeader title="Related" />
            <Surface style={{ paddingVertical: 4 }}>
              {data.related.map((r) => {
                const rUp = r.changePct >= 0;
                return (
                  <Pressable
                    key={r.symbol}
                    onPress={() => router.push({ pathname: "/market/[symbol]", params: { symbol: r.symbol } })}
                    accessibilityRole="button"
                    accessibilityLabel={`${r.symbol}, ${r.name}`}
                    style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[type.body, { fontWeight: "600" }]}>{r.symbol}</Text>
                      <Text style={type.dim} numberOfLines={1}>
                        {r.name}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={type.body}>{usd(r.price)}</Text>
                      <Text style={{ color: rUp ? colors.neon : colors.accent, fontSize: 12 }}>
                        {rUp ? "+" : ""}
                        {r.changePct.toFixed(2)}%
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </Surface>
          </>
        ) : null}

        {data.insights.length > 0 ? (
          <>
            <SectionHeader title="Research" />
            {data.insights.map((i) => (
              <Surface key={i.slug} style={{ gap: 4 }}>
                <Text style={[type.body, { fontWeight: "600" }]}>{i.title}</Text>
                <Text style={type.dim}>
                  {i.signal ? `${i.signal.toUpperCase()} · ` : ""}
                  {i.readMins} min read
                </Text>
              </Surface>
            ))}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  preview: {
    gap: 6,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  previewRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  hero: { fontSize: 36, fontWeight: "800", color: colors.text, letterSpacing: -1 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 8,
  },
});
