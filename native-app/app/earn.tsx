import React, { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { api, ApiError } from "@/lib/api";
import { confirmWithBiometrics } from "@/lib/biometrics";
import { usd } from "@/lib/format";
import { colors, spacing, type } from "@/lib/theme";
import { Button, EmptyState, ErrorNote, Field, Screen, SectionHeader, Surface } from "@/components/ui";

interface Vault {
  address: string;
  name: string;
  netApy: number;
  tvlUsd?: number;
  curator?: string;
  risk?: string;
}

interface Position {
  vault: string;
  vaultName: string;
  apy: number;
  principalUsd: number;
  currentValueUsd: number;
  earnedUsd: number;
  days: number;
}

interface EarnData {
  live: boolean;
  vaults: Vault[];
  positions: Position[];
  summary: { totalPrincipal?: number; totalValue?: number; totalEarned?: number; blendedApy?: number };
  idleUsdc: number;
  bestApy: number;
  disclosure: string;
}

export default function Earn() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["earn"],
    queryFn: () => api<EarnData>("/earn"),
  });

  const [depositAmount, setDepositAmount] = useState("");
  const [selectedVault, setSelectedVault] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const act = async (kind: "deposit" | "withdraw", body: Record<string, unknown>, prompt: string) => {
    setActionError(null);
    setNotice(null);
    if (!(await confirmWithBiometrics(prompt))) return;
    setBusy(true);
    try {
      await api(`/earn/${kind}`, { method: "POST", body });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNotice(kind === "deposit" ? "Deposited — interest starts accruing now." : "Withdrawal complete.");
      setDepositAmount("");
      await qc.invalidateQueries({ queryKey: ["earn"] });
      await qc.invalidateQueries({ queryKey: ["overview"] });
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <Screen>
        <EmptyState
          title={isLoading ? "Loading…" : "Couldn't load Earn"}
          subtitle={error ? (error as Error).message : undefined}
        />
      </Screen>
    );
  }

  const totalValue = data.positions.reduce((s, p) => s + p.currentValueUsd, 0);
  const totalEarned = data.positions.reduce((s, p) => s + p.earnedUsd, 0);
  const amountNum = Number(depositAmount);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.neon} />
        }
      >
        <View style={{ gap: 4 }}>
          <Text style={type.dim}>Yield balance</Text>
          <Text style={styles.hero}>{usd(totalValue)}</Text>
          <Text style={{ color: colors.neon, fontWeight: "600" }}>
            +{usd(totalEarned)} earned · best APY {data.bestApy}%
          </Text>
          <Text style={type.dim}>{usd(data.idleUsdc)} idle USDC available to deposit</Text>
        </View>

        <SectionHeader title="Deposit" />
        <Surface style={{ gap: spacing.sm }}>
          <Field
            label="Amount (USDC)"
            value={depositAmount}
            onChangeText={setDepositAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
          <Button
            title={selectedVault ? "Deposit into selected vault" : "Deposit (best APY vault)"}
            loading={busy}
            disabled={!(amountNum > 0) || amountNum > data.idleUsdc}
            onPress={() =>
              void act(
                "deposit",
                { amountUsd: amountNum, ...(selectedVault ? { vault: selectedVault } : {}) },
                `Deposit ${usd(amountNum)} into FurlPay Earn`
              )
            }
          />
          {amountNum > data.idleUsdc ? (
            <Text style={{ color: colors.warning, fontSize: 13 }}>
              Exceeds your idle USDC ({usd(data.idleUsdc)}).
            </Text>
          ) : null}
        </Surface>

        {data.positions.length > 0 ? (
          <>
            <SectionHeader title="Your positions" />
            {data.positions.map((p) => (
              <Surface key={p.vault} style={{ gap: 6 }}>
                <View style={styles.row}>
                  <Text style={[type.body, { fontWeight: "700", flex: 1 }]} numberOfLines={1}>
                    {p.vaultName}
                  </Text>
                  <Text style={{ color: colors.neon, fontWeight: "700" }}>{p.apy}% APY</Text>
                </View>
                <View style={styles.row}>
                  <Text style={type.dim}>
                    {usd(p.principalUsd)} principal · {p.days}d
                  </Text>
                  <Text style={type.body}>
                    {usd(p.currentValueUsd)}{" "}
                    <Text style={{ color: colors.neon }}>(+{usd(p.earnedUsd)})</Text>
                  </Text>
                </View>
                <Button
                  title="Withdraw all"
                  variant="secondary"
                  onPress={() =>
                    void act(
                      "withdraw",
                      { vault: p.vault, amountUsd: p.currentValueUsd },
                      `Withdraw ${usd(p.currentValueUsd)} from ${p.vaultName}`
                    )
                  }
                />
              </Surface>
            ))}
          </>
        ) : null}

        <SectionHeader title="Curated vaults" />
        {data.vaults.map((v) => {
          const active = selectedVault === v.address;
          return (
            <Surface
              key={v.address}
              style={[{ gap: 4 }, active && { borderColor: colors.neon, borderWidth: 1 }]}
            >
              <View style={styles.row}>
                <Text style={[type.body, { fontWeight: "700", flex: 1 }]} numberOfLines={1}>
                  {v.name}
                </Text>
                <Text style={{ color: colors.neon, fontWeight: "800", fontSize: 18 }}>{v.netApy}%</Text>
              </View>
              <View style={styles.row}>
                <Text style={type.dim}>
                  {v.curator ? `${v.curator} · ` : ""}
                  {v.risk ?? "Curated"} {v.tvlUsd ? `· TVL ${usd(v.tvlUsd)}` : ""}
                </Text>
                <Button
                  title={active ? "Selected" : "Select"}
                  variant={active ? "primary" : "secondary"}
                  onPress={() => setSelectedVault(active ? null : v.address)}
                  style={{ paddingVertical: 6, paddingHorizontal: 14 }}
                />
              </View>
            </Surface>
          );
        })}

        {notice ? <Text style={{ color: colors.neon }}>{notice}</Text> : null}
        <ErrorNote message={actionError} />
        <Text style={[type.dim, { color: colors.textFaint, fontSize: 12 }]}>{data.disclosure}</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  hero: { fontSize: 36, fontWeight: "800", color: colors.text, letterSpacing: -1 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
});
