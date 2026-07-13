import React, { useEffect, useState } from "react";
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { api, API_BASE, ApiError } from "@/lib/api";
import { approveCardChallenge, isPasskeySupported, passkeyErrorMessage } from "@/lib/passkey";
import { usd } from "@/lib/format";
import { colors, spacing, type } from "@/lib/theme";
import { Button, EmptyState, ErrorNote, Screen, Surface } from "@/components/ui";

interface Challenge {
  id: string;
  amountUsd: number;
  currency: string;
  merchant: string;
  cardId: string;
  createdAt: number;
  expiresAt: number;
}

function Countdown({ expiresAt }: { expiresAt: number }) {
  const [left, setLeft] = useState(Math.max(0, expiresAt - Date.now()));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, expiresAt - Date.now())), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  const s = Math.floor(left / 1000);
  return (
    <Text style={{ color: s < 30 ? colors.accent : colors.warning, fontWeight: "700" }}>
      {s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} left` : "expired"}
    </Text>
  );
}

export default function Approvals() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["challenges"],
    queryFn: () => api<{ challenges: Challenge[] }>("/cards/challenges"),
    refetchInterval: 10_000, // pending 3DS2 challenges are time-critical
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const challenges = data?.challenges ?? [];
  const siteBase = API_BASE.replace(/\/api$/, "");

  const approve = async (c: Challenge) => {
    setActionError(null);
    setBusyId(c.id);
    try {
      await approveCardChallenge(c.id);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await qc.invalidateQueries({ queryKey: ["challenges"] });
    } catch (e) {
      if (e instanceof ApiError) {
        // 412 = no passkey enrolled for this account yet.
        setActionError(
          e.status === 412
            ? "No passkey on this account yet — enroll your fingerprint in Settings → Security first."
            : e.message
        );
      } else {
        const msg = passkeyErrorMessage(e);
        // A user dismissing the fingerprint sheet is a non-event, not an error.
        if (!/cancelled/i.test(msg)) setActionError(msg);
      }
    } finally {
      setBusyId(null);
    }
  };

  const decline = async (c: Challenge) => {
    setActionError(null);
    try {
      await api("/cards/challenges/verify", {
        method: "POST",
        body: { challengeId: c.id, decision: "declined" },
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      await qc.invalidateQueries({ queryKey: ["challenges"] });
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : (e as Error).message);
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
          Card purchases that need your explicit approval (3-D Secure). Approving requires your
          passkey; declining is instant.
        </Text>

        {challenges.length === 0 ? (
          <EmptyState
            title={isLoading ? "Loading…" : error ? "Couldn't load approvals" : "Nothing to approve"}
            subtitle={
              error ? (error as Error).message : "When a purchase needs verification it appears here."
            }
          />
        ) : (
          challenges.map((c) => (
            <Surface key={c.id} style={{ gap: spacing.sm }}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { fontWeight: "700", fontSize: 17 }]}>{c.merchant}</Text>
                  <Countdown expiresAt={c.expiresAt} />
                </View>
                <Text style={[type.h2, { fontSize: 24 }]}>{usd(c.amountUsd)}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <Button
                  title={busyId === c.id ? "Waiting for fingerprint…" : "Approve with passkey"}
                  // Native ceremony when Credential Manager is available;
                  // otherwise the web approval page still works (same account).
                  onPress={() =>
                    isPasskeySupported()
                      ? void approve(c)
                      : void Linking.openURL(`${siteBase}/cards/approve?challenge=${c.id}`)
                  }
                  disabled={busyId !== null}
                  style={{ flex: 1 }}
                />
                <Button title="Decline" variant="danger" onPress={() => void decline(c)} style={{ flex: 1 }} />
              </View>
            </Surface>
          ))
        )}
        <ErrorNote message={actionError} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
});
