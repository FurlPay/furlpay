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
import { LinearGradient } from "expo-linear-gradient";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useCards } from "@/lib/queries";
import { usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { EmptyState, ErrorNote, Screen, Surface } from "@/components/ui";
import type { PaymentCard } from "@/lib/types";

function CardVisual({ card }: { card: PaymentCard }) {
  const [c1, c2] = card.gradient ?? [colors.surfaceRaised, colors.surface];
  return (
    <View style={styles.cardShadow}>
      <LinearGradient
        colors={[c1, c2]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <View style={styles.cardTop}>
          <View>
            <Text style={[type.body, { fontWeight: "700" }]}>{card.label}</Text>
            <Text style={[type.dim, { textTransform: "uppercase", letterSpacing: 1, fontSize: 11 }]}>
              {card.kind === "physical" ? "Physical" : "Virtual"}
            </Text>
          </View>
          <Text style={[type.body, { fontWeight: "800", fontStyle: "italic", fontSize: 18 }]}>
            {card.network}
          </Text>
        </View>
        <View style={styles.chip} />
        <View style={styles.cardTop}>
          <Text style={styles.pan}>•••• {card.last4}</Text>
          <Text style={type.dim}>{card.settlementCurrency}</Text>
        </View>
        {card.frozen ? (
          <View style={styles.frozenOverlay}>
            <View style={styles.frozenPill}>
              <Text style={{ color: colors.text, fontWeight: "700", fontSize: 13 }}>Frozen</Text>
            </View>
          </View>
        ) : null}
      </LinearGradient>
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
  cardShadow: {
    borderRadius: radius.lg,
    // Android elevation needs a backgroundColor on the same view to render.
    backgroundColor: colors.bg,
    elevation: 12,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  card: {
    aspectRatio: 1.586, // real credit-card proportion
    borderRadius: radius.lg,
    padding: spacing.lg,
    justifyContent: "space-between",
    overflow: "hidden",
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chip: {
    width: 42,
    height: 30,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  frozenOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  frozenPill: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pan: { color: colors.text, fontSize: 22, letterSpacing: 3, fontFamily: "monospace" },
  controlRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  meter: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: "hidden",
  },
  meterFill: { height: "100%", backgroundColor: colors.neon },
});
