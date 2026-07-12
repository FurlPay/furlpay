import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { api, ApiError } from "@/lib/api";
import { usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, EmptyState, ErrorNote, Screen, SectionHeader, Surface } from "@/components/ui";

interface FiatAccount {
  currency: string;
  amount: number;
  usdValue: number;
  localDetails?: Record<string, string>;
}

const PROVISIONABLE = ["USD", "EUR", "GBP", "INR"] as const;

const DETAIL_LABEL: Record<string, string> = {
  iban: "IBAN",
  swift: "SWIFT/BIC",
  routingNumber: "Routing number",
  accountNumber: "Account number",
  sortCode: "Sort code",
  ifsc: "IFSC",
  bankAddress: "Bank",
};

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <Pressable
      onPress={() =>
        void Clipboard.setStringAsync(value).then(() =>
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        )
      }
      style={({ pressed }) => [styles.copyRow, pressed && { opacity: 0.6 }]}
    >
      <Text style={type.dim}>{label}</Text>
      <Text style={[type.mono, { color: colors.text, flexShrink: 1, textAlign: "right" }]}>{value}</Text>
    </Pressable>
  );
}

export default function Banking() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["banking"],
    queryFn: () => api<{ accounts: FiatAccount[] }>("/banking"),
  });
  const [provisioning, setProvisioning] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const accounts = data?.accounts ?? [];
  const provisioned = new Set(accounts.filter((a) => a.localDetails).map((a) => a.currency));

  const provision = async (currency: string) => {
    setActionError(null);
    setProvisioning(currency);
    try {
      await api("/banking", { method: "POST", body: { currency } });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await qc.invalidateQueries({ queryKey: ["banking"] });
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setProvisioning(null);
    }
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.neon} />
        }
      >
        <Text style={type.dim}>
          Virtual local accounts in your name — receive bank transfers like a local, spend as
          stablecoins. Tap any detail to copy it.
        </Text>

        {accounts.length === 0 ? (
          <EmptyState
            title={isLoading ? "Loading…" : error ? "Couldn't load accounts" : "No accounts yet"}
            subtitle={error ? (error as Error).message : undefined}
          />
        ) : (
          accounts.map((a) => (
            <Surface key={a.currency} style={{ gap: 6 }}>
              <View style={styles.row}>
                <Text style={[type.body, { fontWeight: "700" }]}>{a.currency}</Text>
                <Text style={[type.h2, { color: colors.neon }]}>{usd(a.usdValue)}</Text>
              </View>
              <Text style={type.dim}>
                {a.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} {a.currency}
              </Text>
              {a.localDetails ? (
                Object.entries(a.localDetails).map(([k, v]) => (
                  <CopyRow key={k} label={DETAIL_LABEL[k] ?? k} value={v} />
                ))
              ) : (
                <Button
                  title={`Get ${a.currency} account details`}
                  variant="secondary"
                  loading={provisioning === a.currency}
                  onPress={() => void provision(a.currency)}
                />
              )}
            </Surface>
          ))
        )}

        <SectionHeader title="Open a new account" />
        <View style={styles.chips}>
          {PROVISIONABLE.filter((c) => !provisioned.has(c)).map((c) => (
            <Pressable
              key={c}
              onPress={() => void provision(c)}
              style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
            >
              <Text style={{ color: colors.text, fontWeight: "600" }}>
                {provisioning === c ? "…" : `+ ${c}`}
              </Text>
            </Pressable>
          ))}
        </View>
        <ErrorNote message={actionError} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  copyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 8,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
});
