import React, { useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { api, ApiError } from "@/lib/api";
import { confirmWithBiometrics } from "@/lib/biometrics";
import { usd } from "@/lib/format";
import { colors, spacing, type } from "@/lib/theme";
import { Button, EmptyState, ErrorNote, Field, Screen, SectionHeader, Surface } from "@/components/ui";
import { PriceChart } from "@/components/PriceChart";
import { AssetLogo } from "@/components/AssetLogo";

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

  // One Idempotency-Key per order INTENT, not per tap. A timeout followed by a
  // re-tap must replay the same order, never place a second one — so the key
  // survives network failures, and rotates only when the intent changes
  // (amount/side edited) or the server has actually answered: a fill consumes
  // it, a rejection ends it, and the next attempt is a new order either way.
  const orderKey = useRef<string | null>(null);
  useEffect(() => {
    orderKey.current = null;
  }, [notional, side]);

  const placeOrder = async () => {
    const amt = Number(notional);
    if (!(amt > 0) || !data) return;
    setOrderError(null);
    const confirmed = await confirmWithBiometrics(
      `${side === "buy" ? "Buy" : "Sell"} ${usd(amt)} of ${data.asset.symbol}`
    );
    if (!confirmed) return;
    setBusy(true);
    orderKey.current ??= crypto.randomUUID();
    try {
      const res = await api<{ orderId: string; status: string; filledQty: number }>("/investing/order", {
        method: "POST",
        headers: { "Idempotency-Key": orderKey.current },
        body: { symbol: data.asset.symbol, side, notional: amt },
      });
      orderKey.current = null;
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPlaced(`${res.status === "filled" ? "Filled" : "Placed"} — ${res.filledQty.toFixed(4)} shares`);
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
            <Field
              label="Amount (USD, fractional)"
              value={notional}
              onChangeText={setNotional}
              keyboardType="decimal-pad"
              placeholder="25.00"
            />
            <Button
              title={`${side === "buy" ? "Buy" : "Sell"} ${data.asset.symbol}`}
              loading={busy}
              disabled={!(Number(notional) > 0)}
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
  hero: { fontSize: 36, fontWeight: "800", color: colors.text, letterSpacing: -1 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 8,
  },
});
