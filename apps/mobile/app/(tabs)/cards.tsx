import React, { useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useCards } from "@/lib/queries";
import { usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { EmptyState, ErrorNote, Screen, StatusBadge, Surface } from "@/components/ui";
import type { PaymentCard } from "@/lib/types";

function CardVisual({ card }: { card: PaymentCard }) {
  return (
    <View style={[styles.card, { backgroundColor: card.gradient?.[0] ?? colors.surfaceRaised }]}>
      <View style={styles.cardTop}>
        <Text style={[type.body, { fontWeight: "700" }]}>{card.label}</Text>
        <StatusBadge status={card.frozen ? "frozen" : "active"} />
      </View>
      <Text style={styles.pan}>•••• •••• •••• {card.last4}</Text>
      <View style={styles.cardTop}>
        <Text style={type.dim}>{card.kind === "physical" ? "Physical" : "Virtual"}</Text>
        <Text style={[type.body, { fontWeight: "700", fontStyle: "italic" }]}>{card.network}</Text>
      </View>
    </View>
  );
}

function CardControls({ card }: { card: PaymentCard }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pendingFrozen, setPendingFrozen] = useState<boolean | null>(null);

  const frozen = pendingFrozen ?? card.frozen;
  const spentPct = card.limits.daily > 0 ? Math.min(1, card.limits.dailySpent / card.limits.daily) : 0;

  const toggleFreeze = async (value: boolean) => {
    setError(null);
    setPendingFrozen(value);
    try {
      await api("/cards/settings", { method: "POST", body: { cardId: card.id, freeze: value } });
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await qc.invalidateQueries({ queryKey: ["cards"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
      setPendingFrozen(null);
    }
  };

  return (
    <Surface style={{ gap: spacing.sm }}>
      <View style={styles.controlRow}>
        <Text style={type.body}>Freeze card</Text>
        <Switch
          value={frozen}
          onValueChange={(v) => void toggleFreeze(v)}
          trackColor={{ true: colors.neonDeep, false: colors.surfaceRaised }}
          thumbColor={frozen ? colors.neon : colors.textDim}
        />
      </View>
      <View style={{ gap: 6 }}>
        <View style={styles.controlRow}>
          <Text style={type.dim}>Daily spend</Text>
          <Text style={type.dim}>
            {usd(card.limits.dailySpent)} / {usd(card.limits.daily)}
          </Text>
        </View>
        <View style={styles.meter}>
          <View style={[styles.meterFill, { width: `${spentPct * 100}%` }]} />
        </View>
        <Text style={type.dim}>Per-purchase limit {usd(card.limits.perPurchase)}</Text>
      </View>
      <ErrorNote message={error} />
    </Surface>
  );
}

export default function Cards() {
  const { data: result, isLoading, refetch, isRefetching, error } = useCards();
  const cards = result?.data ?? [];

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.neon} />
        }
      >
        {cards.length === 0 ? (
          <EmptyState
            title={isLoading ? "Loading…" : error ? "Couldn't load cards" : "No cards yet"}
            subtitle={error ? (error as Error).message : "Issue a virtual card from the web dashboard."}
          />
        ) : (
          cards.map((card) => (
            <View key={card.id} style={{ gap: spacing.sm }}>
              <CardVisual card={card} />
              <CardControls card={card} />
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  card: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.lg,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pan: { color: colors.text, fontSize: 20, letterSpacing: 2, fontFamily: "monospace" },
  controlRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  meter: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: "hidden",
  },
  meterFill: { height: "100%", backgroundColor: colors.neon },
});
