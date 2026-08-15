import React, { useEffect, useRef, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api, API_BASE, ApiError } from "@/lib/api";
import * as Haptics from "expo-haptics";
import { confirmWithBiometrics } from "@/lib/biometrics";
import { usePortfolio } from "@/lib/queries";
import { COLLECTIONS } from "@/lib/discover";
import { usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import {
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Screen,
  SectionHeader,
  Segmented,
  Sheet,
  Surface,
} from "@/components/ui";
import { CollectionsCarousel, MarketPulse, TrendingCarousel, useMovers } from "@/components/Discover";
import { AssetLogo } from "@/components/AssetLogo";

// Investing hub — native counterpart of apps/web/src/app/investing/page.tsx:
// portfolio summary, market pulse, holdings, FurlPay Research, discovery
// (movers, collections, categories) and recurring investments (SIP).

interface InsightMeta {
  slug: string;
  title: string;
  category: string;
  readMins: number;
  signal: "bullish" | "bearish" | "neutral" | null;
  tickers: string[];
}

const SIGNAL_COLOR: Record<string, string> = {
  bullish: colors.neon,
  bearish: colors.accent,
  neutral: colors.textDim,
};

// Same slugs the web page curates under "Collections for you".
const FEATURED_COLLECTIONS = ["ai-robotics", "crypto-blue-chips", "dividend-kings", "semiconductors", "defi-blue-chips"];

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
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      /* The icon carries no text, so the visible label IS the whole name. */
      accessibilityLabel={label}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={20} color={colors.neon} />
      </View>
      <Text style={type.dim}>{label}</Text>
    </Pressable>
  );
}

// Dividend settlement — the engine and route existed (dividends/settle, with
// DRIP built in) but the app only DISPLAYED entitlements: a user could see
// unsettled money with no way to receive it. Two actions, one flag apart.
//
// No client idempotency key on purpose: the settle route reconciles against
// its own settlement state and is designed to be safe to run twice — the
// server, not this screen, decides what was already paid. The response is
// reported verbatim (settled 0 → "nothing to settle yet"), never guessed.
function DividendActions({ onSettled }: { onSettled: () => void }) {
  const [busy, setBusy] = useState<"cash" | "drip" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settle = async (drip: boolean) => {
    setError(null);
    setMessage(null);
    const confirmed = await confirmWithBiometrics(
      drip ? "Reinvest dividends into more shares" : "Collect dividends as cash"
    );
    if (!confirmed) return;
    setBusy(drip ? "drip" : "cash");
    try {
      const res = await api<{ settled: number; cashCredited: number; reinvested: number }>(
        "/investing/dividends/settle",
        { method: "POST", body: { drip } }
      );
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMessage(
        res.settled === 0
          ? "Nothing to settle yet — entitlements are still pending."
          : drip
            ? `Reinvested ${usd(res.reinvested)} across ${res.settled} dividend${res.settled === 1 ? "" : "s"}.`
            : `Credited ${usd(res.cashCredited)} to your balance.`
      );
      onSettled();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button
          title="Collect as cash"
          variant="secondary"
          loading={busy === "cash"}
          disabled={busy !== null}
          onPress={() => void settle(false)}
          style={{ flex: 1 }}
        />
        <Button
          title="Reinvest (DRIP)"
          variant="primary"
          loading={busy === "drip"}
          disabled={busy !== null}
          onPress={() => void settle(true)}
          style={{ flex: 1 }}
        />
      </View>
      {message ? <Text style={{ color: colors.neon }}>{message}</Text> : null}
      <ErrorNote message={error} />
    </View>
  );
}

// Recurring investment (SIP) — first installment executes immediately via
// /api/investing/order; the schedule itself is demo-local (same as web).
function SipSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [symbol, setSymbol] = useState("VOO");
  const [amount, setAmount] = useState("100");
  const [cadence, setCadence] = useState<"weekly" | "monthly">("monthly");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same idempotency contract as the order ticket: the key survives a network
  // failure (a re-tap replays, never double-buys) and rotates when the intent
  // changes or the server has answered. See market/[symbol].tsx.
  const orderKey = useRef<string | null>(null);
  useEffect(() => {
    orderKey.current = null;
  }, [symbol, amount]);

  const start = async () => {
    setBusy(true);
    setError(null);
    orderKey.current ??= crypto.randomUUID();
    try {
      await api("/investing/order", {
        method: "POST",
        headers: { "Idempotency-Key": orderKey.current },
        body: {
          symbol: symbol.toUpperCase(),
          side: "buy",
          notional: Number(amount),
          type: "market",
          time_in_force: "day",
        },
      });
      orderKey.current = null;
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError) orderKey.current = null;
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      title="Recurring investment"
      onClose={() => {
        setDone(false);
        onClose();
      }}
    >
      {done ? (
        <Surface style={{ alignItems: "center", gap: 6 }}>
          <Ionicons name="checkmark-circle" size={32} color={colors.neon} />
          <Text style={[type.body, { fontWeight: "700" }]}>SIP active</Text>
          <Text style={[type.dim, { textAlign: "center" }]}>
            ${amount} of {symbol.toUpperCase()} every {cadence === "weekly" ? "week" : "month"} — first
            installment filled.
          </Text>
        </Surface>
      ) : (
        <View style={{ gap: spacing.md }}>
          <Field
            label="Symbol"
            value={symbol}
            onChangeText={(t) => setSymbol(t.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <Field
            label="Amount (USD)"
            value={amount}
            onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ""))}
            keyboardType="decimal-pad"
          />
          <Segmented options={["weekly", "monthly"] as const} value={cadence} onChange={setCadence} />
          <ErrorNote message={error} />
          <Button
            title="Start SIP"
            loading={busy}
            disabled={!(Number(amount) > 0) || !symbol.trim()}
            onPress={() => void start()}
          />
        </View>
      )}
    </Sheet>
  );
}

export default function Invest() {
  const router = useRouter();
  const [sipOpen, setSipOpen] = useState(false);
  const { data: result, isLoading, refetch, isRefetching, error } = usePortfolio();
  const portfolio = result?.data;

  const { data: insightsData } = useQuery({
    queryKey: ["insights", 4],
    queryFn: () => api<{ items: InsightMeta[] }>("/insights?limit=4"),
    staleTime: 5 * 60_000,
  });
  const insights = insightsData?.items ?? [];
  const { data: moversData } = useMovers(6);
  const siteBase = API_BASE.replace(/\/api$/, "");

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

        {/* Quick actions */}
        <View style={styles.actions}>
          <QuickAction icon="trending-up-outline" label="Buy" onPress={() => router.push("/markets")} />
          <QuickAction icon="repeat-outline" label="Recurring" onPress={() => setSipOpen(true)} />
          <QuickAction icon="leaf-outline" label="Earn" onPress={() => router.push("/earn")} />
          <QuickAction icon="newspaper-outline" label="Research" onPress={() => router.push("/insights")} />
        </View>

        {/* Market pulse */}
        <SectionHeader title="Market pulse" />
        <MarketPulse />

        <SectionHeader
          title="Holdings"
          right={
            <Pressable
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Order history"
              onPress={() => router.push({ pathname: "/transactions", params: { category: "invest" } })}
            >
              <Text style={{ color: colors.neon, fontWeight: "600", fontSize: 13 }}>Order history</Text>
            </Pressable>
          }
        />
        {portfolio?.holdings.length ? (
          <Surface style={{ paddingVertical: 4 }}>
            {portfolio.holdings.map((h) => {
              const hUp = h.changePct >= 0;
              return (
                <Pressable
                  key={h.symbol}
                  accessibilityRole="button"
                  /* Symbol alone reads as an initialism; the holding's value and
                     direction are what the row actually communicates. */
                  accessibilityLabel={`${h.symbol}, ${usd(h.marketValue)}, ${hUp ? "up" : "down"} ${Math.abs(h.changePct).toFixed(2)} percent`}
                  onPress={() => router.push({ pathname: "/market/[symbol]", params: { symbol: h.symbol } })}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                >
                  <AssetLogo symbol={h.symbol} logo={h.logo} size={36} />
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
                </Pressable>
              );
            })}
          </Surface>
        ) : (
          <EmptyState
            title={isLoading ? "Loading…" : error ? "Couldn't load portfolio" : "No holdings yet"}
            subtitle={error ? (error as Error).message : "Buy fractional stocks & ETFs from Markets."}
          />
        )}

        {/* FurlPay Research */}
        {insights.length ? (
          <>
            <SectionHeader
              title="Latest from FurlPay Research"
              right={
                <Pressable
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="View all insights"
                  onPress={() => router.push("/insights")}
                >
                  <Text style={{ color: colors.neon, fontWeight: "600" }}>View all</Text>
                </Pressable>
              }
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {insights.map((i) => (
                <Pressable
                  key={i.slug}
                  accessibilityRole="link"
                  accessibilityLabel={i.title}
                  /* Says it leaves the app, which a sighted user infers from
                     the card styling and a screen-reader user cannot. */
                  accessibilityHint="Opens in your browser"
                  onPress={() => void Linking.openURL(`${siteBase}/investing/insights/${i.slug}`)}
                  style={({ pressed }) => [styles.insightCard, pressed && { opacity: 0.8 }]}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={[type.dim, { fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }]}>
                      {i.category}
                    </Text>
                    {i.signal ? (
                      <Text style={{ color: SIGNAL_COLOR[i.signal], fontWeight: "800", fontSize: 10 }}>
                        {i.signal.toUpperCase()}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[type.body, { fontWeight: "700", fontSize: 13 }]} numberOfLines={3}>
                    {i.title}
                  </Text>
                  <Text style={[type.dim, { fontSize: 10.5 }]} numberOfLines={1}>
                    {i.readMins} min read · {i.tickers.slice(0, 3).join(" · ")}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : null}

        {/* Trending today */}
        {moversData?.gainers.length ? (
          <>
            <SectionHeader title="Trending today" />
            <TrendingCarousel movers={moversData.gainers} />
          </>
        ) : null}

        {/* Collections for you */}
        <SectionHeader title="Collections for you" />
        <CollectionsCarousel
          collections={COLLECTIONS.filter((c) => FEATURED_COLLECTIONS.includes(c.slug))}
        />

        {/* Explore by category */}
        <View style={styles.categoryGrid}>
          {(
            [
              { label: "US Stocks", sub: "200+ listed", icon: "stats-chart-outline", go: () => router.push({ pathname: "/markets", params: { kind: "stock" } }) },
              { label: "ETFs", sub: "68 funds", icon: "business-outline", go: () => router.push({ pathname: "/markets", params: { kind: "etf" } }) },
              { label: "Crypto", sub: "100+ assets", icon: "logo-bitcoin", go: () => router.push({ pathname: "/markets", params: { kind: "crypto" } }) },
              { label: "Blockchains", sub: "25 networks", icon: "cube-outline", go: () => router.push("/chains") },
            ] as const
          ).map((c) => (
            <Pressable
              key={c.label}
              accessibilityRole="button"
              accessibilityLabel={c.label}
              onPress={c.go}
              style={({ pressed }) => [styles.categoryTile, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.categoryIcon}>
                <Ionicons name={c.icon} size={18} color={colors.textDim} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[type.body, { fontWeight: "700", fontSize: 13.5 }]}>{c.label}</Text>
                <Text style={[type.dim, { fontSize: 11 }]}>{c.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
            </Pressable>
          ))}
        </View>

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
            <DividendActions onSettled={() => void refetch()} />
          </>
        ) : null}
      </ScrollView>
      <SipSheet open={sipOpen} onClose={() => setSipOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  value: { fontSize: 40, fontWeight: "800", color: colors.text, letterSpacing: -1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  actions: { flexDirection: "row", justifyContent: "space-between", marginVertical: spacing.xs },
  action: { alignItems: "center", gap: 6, flex: 1 },
  actionIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.neonSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  insightCard: {
    width: 220,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 12,
    gap: 8,
  },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  categoryTile: {
    width: "48%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 12,
  },
  categoryIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
});
