import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/lib/auth";
import { useOverview } from "@/lib/queries";
import { API_BASE } from "@/lib/api";
import { shortAddress } from "@/lib/format";
import { colors, spacing, type } from "@/lib/theme";
import { Button, Screen, SectionHeader, StatusBadge, Surface } from "@/components/ui";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={type.dim}>{label}</Text>
      {typeof value === "string" ? <Text style={type.body}>{value}</Text> : value}
    </View>
  );
}

function NavRow({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.navRow, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={18} color={colors.neon} />
      <Text style={[type.body, { flex: 1 }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

export default function Settings() {
  const router = useRouter();
  const signOut = useAuth((s) => s.signOut);
  const { data: result } = useOverview();
  const user = result?.data.user;

  const copyAddress = async () => {
    if (!user?.safeAddress) return;
    await Clipboard.setStringAsync(user.safeAddress);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title="Profile" />
        <Surface style={{ gap: 4 }}>
          <Row label="Name" value={user?.name ?? "—"} />
          <Row label="Region" value={user?.region ?? "—"} />
          <Row label="Tier" value={user?.tier ?? "—"} />
          <Row label="KYC" value={<StatusBadge status={user?.kycStatus ?? "unknown"} />} />
          <Row label="Wallet" value={shortAddress(user?.safeAddress, 8) || "—"} />
        </Surface>
        <Button title="Copy wallet address" variant="secondary" onPress={() => void copyAddress()} />

        <SectionHeader title="Money" />
        <Surface style={{ paddingVertical: 4 }}>
          <NavRow icon="business-outline" label="Banking — local accounts" onPress={() => router.push("/banking")} />
          <NavRow icon="pie-chart-outline" label="Spending analytics" onPress={() => router.push("/analytics")} />
          <NavRow icon="gift-outline" label="Rewards & referrals" onPress={() => router.push("/rewards")} />
          <NavRow icon="shield-checkmark-outline" label="Card approvals (3DS)" onPress={() => router.push("/approvals")} />
          <NavRow icon="sparkles-outline" label="AI co-pilot" onPress={() => router.push("/chat")} />
        </Surface>

        <SectionHeader title="Security" />
        <Surface style={{ gap: 4 }}>
          <Text style={type.body}>Biometric unlock</Text>
          <Text style={type.dim}>
            FurlPay locks with your device fingerprint or face whenever the app restarts. Sends always
            require biometric confirmation.
          </Text>
        </Surface>

        <SectionHeader title="About" />
        <Surface style={{ gap: 4 }}>
          <Row label="App version" value={`${Constants.expoConfig?.version ?? "2.0.0"} (native)`} />
          <Row label="API" value={API_BASE.replace("https://", "")} />
        </Surface>

        <Button title="Sign out" variant="danger" onPress={() => void signOut()} />
        <Text style={[type.dim, { textAlign: "center", color: colors.textFaint }]}>
          FurlPay — stablecoin payments, cards & investing
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
});
