import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { api, ApiError } from "@/lib/api";
import { authorizeMoneyMove } from "@/lib/money/authorize";
import { usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, EmptyState, ErrorNote, Field, Screen, Segmented, SummaryRow, Surface } from "@/components/ui";

interface Bill {
  id: string;
  provider: string;
  category: string;
  balanceDue: number;
  dueDate: string;
  autopay: boolean;
}

const CATEGORY_LABEL: Record<string, string> = {
  utility: "Utility",
  "credit-card": "Credit card",
  mortgage: "Mortgage",
  loan: "Loan",
  telecom: "Telecom",
};

function daysUntil(iso: string): number {
  return Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
}

function BillRow({ bill }: { bill: Bill }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const due = daysUntil(bill.dueDate);
  const overdue = due < 0 && bill.balanceDue > 0;

  const act = async (action: "pay" | "toggleAutopay") => {
    setError(null);
    if (action === "pay") {
      const decision = await authorizeMoneyMove({
        action: "send_funds",
        amountUsd: bill.balanceDue,
        reason: `Pay ${bill.provider} ${usd(bill.balanceDue)}`,
      });
      if (!decision.ok) {
        if (decision.kind !== "declined") setError(decision.message);
        return;
      }
      setPaying(true);
    }
    try {
      await api("/bills", { method: "POST", body: { id: bill.id, action } });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await qc.invalidateQueries({ queryKey: ["bills"] });
      await qc.invalidateQueries({ queryKey: ["overview"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setPaying(false);
    }
  };

  return (
    <Surface style={{ gap: spacing.sm }}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={[type.body, { fontWeight: "700" }]}>{bill.provider}</Text>
          <Text style={type.dim}>
            {CATEGORY_LABEL[bill.category] ?? bill.category} ·{" "}
            {bill.balanceDue > 0
              ? overdue
                ? `${-due}d overdue`
                : `due in ${due}d`
              : "paid"}
          </Text>
        </View>
        <Text
          style={[
            type.h2,
            { color: overdue ? colors.accent : bill.balanceDue > 0 ? colors.text : colors.neon },
          ]}
        >
          {bill.balanceDue > 0 ? usd(bill.balanceDue) : "✓"}
        </Text>
      </View>
      <View style={styles.row}>
        <View style={styles.row}>
          <Text style={type.dim}>Autopay (SMARTPay)</Text>
          <Switch
            value={bill.autopay}
            onValueChange={() => void act("toggleAutopay")}
            trackColor={{ true: colors.neonDeep, false: colors.surfaceRaised }}
            thumbColor={bill.autopay ? colors.neon : colors.textDim}
          />
        </View>
        {bill.balanceDue > 0 ? (
          <Button title="Pay now" onPress={() => void act("pay")} loading={paying} style={{ paddingVertical: 8, paddingHorizontal: 16 }} />
        ) : null}
      </View>
      <ErrorNote message={error} />
    </Surface>
  );
}

// Off-ramp — USDC to a local bank at the Wise mid-market rate, mirroring the
// web /bills "Bank off-ramp" tab (same /api/offramp quote → execute flow).
interface FxQuote {
  amountTo: number;
  feePct: number;
  rail: string;
  midMarketRate: number;
  savingsVsCompetitorPct: number;
  to: string;
}

const OFFRAMP_CURRENCIES = ["EUR", "GBP", "INR", "BRL", "USD"] as const;

function OffRampPanel() {
  const [amount, setAmount] = useState("500");
  const [to, setTo] = useState<string>("EUR");
  const [quote, setQuote] = useState<FxQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amt = Number(amount);

  const getQuote = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ quote: FxQuote }>("/offramp", {
        method: "POST",
        body: { fromCurrency: "USD", toCurrency: to, amount: amt },
      });
      setQuote(r.quote);
      setDone(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't fetch a quote. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    setError(null);
    // An off-ramp moves money OFF the platform to a bank — withdraw, not send.
    const decision = await authorizeMoneyMove({
      action: "withdraw",
      amountUsd: amt,
      reason: `Off-ramp ${usd(amt)} USDC to ${to}`,
    });
    if (!decision.ok) {
      if (decision.kind !== "declined") setError(decision.message);
      return;
    }
    setBusy(true);
    try {
      await api("/offramp", {
        method: "POST",
        body: { fromCurrency: "USD", toCurrency: to, amount: amt, execute: true },
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Off-ramp failed — nothing was sent. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={type.dim}>
        Off-ramp USDC to a local bank at the Wise mid-market rate + flat fee — no crypto spread.
      </Text>
      <Field
        label="You off-ramp (USDC)"
        value={amount}
        onChangeText={(t) => {
          setAmount(t.replace(/[^0-9.]/g, ""));
          setQuote(null);
        }}
        keyboardType="decimal-pad"
        placeholder="500"
      />
      <View style={{ gap: 6 }}>
        <Text style={type.dim}>Deposit to</Text>
        <View style={styles.chips}>
          {OFFRAMP_CURRENCIES.map((c) => (
            <Pressable
              key={c}
              onPress={() => {
                setTo(c);
                setQuote(null);
              }}
              style={[styles.chip, to === c && { backgroundColor: colors.neon }]}
            >
              <Text style={{ color: to === c ? colors.onNeon : colors.textDim, fontWeight: "700" }}>{c}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {quote ? (
        <Surface style={{ gap: 2 }}>
          <SummaryRow k="You receive" v={`${quote.amountTo.toLocaleString()} ${quote.to}`} bold />
          <SummaryRow k="Mid-market rate" v={String(quote.midMarketRate)} />
          <SummaryRow k="Fee" v={`${quote.feePct}%`} />
          <SummaryRow k="Rail" v={quote.rail} />
          <SummaryRow k="Saves vs RedotPay/Bridge" v={`~${quote.savingsVsCompetitorPct}%`} />
        </Surface>
      ) : null}

      <ErrorNote message={error} />

      {done ? (
        <Surface style={{ alignItems: "center" }}>
          <Text style={{ color: colors.neon, fontWeight: "700" }}>Off-ramp sent via {quote?.rail}</Text>
        </Surface>
      ) : !quote ? (
        <Button title="Get quote" loading={busy} disabled={!(amt > 0)} onPress={() => void getQuote()} />
      ) : (
        <Button title="Confirm off-ramp" loading={busy} onPress={() => void execute()} />
      )}
    </View>
  );
}

export default function Bills() {
  const [tab, setTab] = useState<"bills" | "offramp">("bills");
  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["bills"],
    queryFn: () => api<{ bills: Bill[] }>("/bills"),
  });
  const bills = data?.bills ?? [];
  const totalDue = bills.reduce((s, b) => s + b.balanceDue, 0);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.neon} />
        }
      >
        <Segmented
          options={["bills", "offramp"] as const}
          value={tab}
          onChange={setTab}
          labels={{ bills: "Pay bills", offramp: "Bank off-ramp" }}
        />

        {tab === "bills" ? (
          <>
            <View style={{ gap: 4 }}>
              <Text style={type.dim}>Total due</Text>
              <Text style={styles.hero}>{usd(totalDue)}</Text>
              <Text style={type.dim}>Bills are paid on-chain in USDC — no card fees.</Text>
            </View>
            {bills.length === 0 ? (
              <EmptyState
                title={isLoading ? "Loading…" : error ? "Couldn't load bills" : "No connected bills"}
                subtitle={error ? (error as Error).message : "Connect billers from the web dashboard."}
              />
            ) : (
              bills.map((b) => <BillRow key={b.id} bill={b} />)
            )}
          </>
        ) : (
          <OffRampPanel />
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  hero: { fontSize: 36, fontWeight: "800", color: colors.text, letterSpacing: -1 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
