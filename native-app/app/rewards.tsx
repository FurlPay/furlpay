import React from "react";
import { RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { api } from "@/lib/api";
import { usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, EmptyState, Screen, SectionHeader, Surface } from "@/components/ui";

interface Rewards {
  referral: { code: string; url: string; invited: number; converted: number; earnedUsd: number; perReferralUsd: number };
  membership: { tier: string; nextTier: string | null; points: number; nextThreshold: number; progressPct: number; perks: string[] };
  missions: { id: string; title: string; reward: number; done: boolean }[];
  rewardsBalance: { claimedUsd: number; pendingUsd: number };
}

export default function RewardsScreen() {
  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["rewards"],
    queryFn: () => api<Rewards>("/rewards"),
  });

  const share = async () => {
    if (!data) return;
    await Share.share({
      message: `Join me on FurlPay — stablecoin payments, cards & investing. We both earn ${usd(data.referral.perReferralUsd)}: ${data.referral.url}`,
    });
  };

  const copyCode = async () => {
    if (!data) return;
    await Clipboard.setStringAsync(data.referral.url);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  if (!data) {
    return (
      <Screen>
        <EmptyState
          title={isLoading ? "Loading…" : "Couldn't load rewards"}
          subtitle={error ? (error as Error).message : undefined}
        />
      </Screen>
    );
  }

  const { referral, membership, missions, rewardsBalance } = data;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.neon} />
        }
      >
        <View style={{ gap: 4 }}>
          <Text style={type.dim}>Rewards earned</Text>
          <Text style={styles.hero}>{usd(rewardsBalance.claimedUsd)}</Text>
          <Text style={type.dim}>{usd(rewardsBalance.pendingUsd)} pending from open missions</Text>
        </View>

        <SectionHeader title="Membership" />
        <Surface style={{ gap: spacing.sm }}>
          <View style={styles.row}>
            <Text style={[type.body, { fontWeight: "700" }]}>{membership.tier}</Text>
            {membership.nextTier ? (
              <Text style={type.dim}>
                {membership.points} / {membership.nextThreshold} pts → {membership.nextTier}
              </Text>
            ) : (
              <Text style={{ color: colors.neon, fontWeight: "600" }}>Top tier</Text>
            )}
          </View>
          <View style={styles.meter}>
            <View style={[styles.meterFill, { width: `${membership.progressPct}%` }]} />
          </View>
          {membership.perks.map((p) => (
            <Text key={p} style={type.dim}>
              · {p}
            </Text>
          ))}
        </Surface>

        <SectionHeader title="Refer a friend" />
        <Surface style={{ gap: spacing.sm }}>
          <Text style={type.body}>
            Earn {usd(referral.perReferralUsd)} for every friend who signs up — they get the same.
          </Text>
          <Text style={type.dim}>
            {referral.invited} invited · {referral.converted} joined · {usd(referral.earnedUsd)} earned
          </Text>
          <Text style={[type.mono, { color: colors.neon }]}>{referral.url}</Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Button title="Share link" onPress={() => void share()} style={{ flex: 1 }} />
            <Button title="Copy" variant="secondary" onPress={() => void copyCode()} style={{ flex: 1 }} />
          </View>
        </Surface>

        <SectionHeader title="Missions" />
        <Surface style={{ paddingVertical: 4 }}>
          {missions.map((m) => (
            <View key={m.id} style={[styles.row, { paddingVertical: 10 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                <Text style={{ fontSize: 16, color: m.done ? colors.neon : colors.textFaint }}>
                  {m.done ? "✓" : "○"}
                </Text>
                <Text style={[type.body, m.done && { color: colors.textDim }]} numberOfLines={2}>
                  {m.title}
                </Text>
              </View>
              <Text style={{ color: m.done ? colors.textDim : colors.neon, fontWeight: "700" }}>
                +{usd(m.reward)}
              </Text>
            </View>
          ))}
        </Surface>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  hero: { fontSize: 36, fontWeight: "800", color: colors.text, letterSpacing: -1 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  meter: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, overflow: "hidden" },
  meterFill: { height: "100%", backgroundColor: colors.neon },
});
