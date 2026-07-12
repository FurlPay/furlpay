import React, { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { api, ApiError } from "@/lib/api";
import { usd } from "@/lib/format";
import { colors, spacing, type } from "@/lib/theme";
import { Button, EmptyState, ErrorNote, Screen, Surface } from "@/components/ui";

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
      const enrolled =
        (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
      if (enrolled) {
        const auth = await LocalAuthentication.authenticateAsync({
          promptMessage: `Pay ${bill.provider} ${usd(bill.balanceDue)}`,
        });
        if (!auth.success) return;
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

export default function Bills() {
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
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.neon} />
        }
      >
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
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  hero: { fontSize: 36, fontWeight: "800", color: colors.text, letterSpacing: -1 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
});
