import React, { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { api, API_BASE, ApiError } from "@/lib/api";
import { shortAddress } from "@/lib/format";
import { colors, spacing, type } from "@/lib/theme";
import { Button, ErrorNote, Screen, SectionHeader, StatusBadge, Surface } from "@/components/ui";

// GET/PATCH /api/profile — profile + the low-risk security & notification
// toggles. MFA/TOTP setup stays on the web (privileged flow).
interface Profile {
  id: string;
  name: string;
  email: string | null;
  safeAddress: string;
  kycStatus: string;
  region: string;
  tier: string;
  security: {
    biometricEnabled?: boolean;
    loginAlerts?: boolean;
    totpEnabled?: boolean;
    accountLocked?: boolean;
    lastLoginAt?: string;
  };
  notifications: {
    transactions?: boolean;
    security?: boolean;
    priceAlerts?: boolean;
    product?: boolean;
  };
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={type.dim}>{label}</Text>
      {typeof value === "string" ? <Text style={type.body}>{value}</Text> : value}
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={type.body}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.neonDeep, false: colors.surfaceRaised }}
        thumbColor={value ? colors.neon : colors.textDim}
      />
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
  const qc = useQueryClient();
  const signOut = useAuth((s) => s.signOut);
  const [error, setError] = useState<string | null>(null);

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<Profile>("/profile"),
  });

  const patch = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      await api("/profile", { method: "PATCH", body });
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await qc.invalidateQueries({ queryKey: ["profile"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  };

  const lockAccount = () => {
    Alert.alert(
      "Lock account?",
      "All money movement will be suspended immediately. Unlocking requires signing in on the web and contacting support if needed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Lock now",
          style: "destructive",
          onPress: () => {
            // Locking 423s every subsequent call — sign out right after.
            void patch({ action: "lock" }).then(() => signOut());
          },
        },
      ]
    );
  };

  const copyAddress = async () => {
    if (!profile?.safeAddress) return;
    await Clipboard.setStringAsync(profile.safeAddress);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const sec = profile?.security;
  const notif = profile?.notifications;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title="Profile" />
        <Surface style={{ gap: 4 }}>
          <Row label="Name" value={profile?.name ?? "—"} />
          <Row label="Email" value={profile?.email ?? "—"} />
          <Row label="Region" value={profile?.region ?? "—"} />
          <Row label="Plan" value={profile?.tier ?? "—"} />
          <Row label="KYC" value={<StatusBadge status={profile?.kycStatus ?? "unknown"} />} />
          <Row label="Wallet" value={shortAddress(profile?.safeAddress, 8) || "—"} />
        </Surface>
        <Button title="Copy wallet address" variant="secondary" onPress={() => void copyAddress()} />

        <SectionHeader title="Money" />
        <Surface style={{ paddingVertical: 4 }}>
          <NavRow icon="wallet-outline" label="Self-custodial wallet" onPress={() => router.push("/wallet")} />
          <NavRow icon="business-outline" label="Banking — local accounts" onPress={() => router.push("/banking")} />
          <NavRow icon="pie-chart-outline" label="Spending analytics" onPress={() => router.push("/analytics")} />
          <NavRow icon="gift-outline" label="Rewards & referrals" onPress={() => router.push("/rewards")} />
          <NavRow icon="shield-checkmark-outline" label="Card approvals (3DS)" onPress={() => router.push("/approvals")} />
          <NavRow icon="sparkles-outline" label="AI co-pilot" onPress={() => router.push("/chat")} />
          <NavRow icon="notifications-outline" label="Notifications inbox" onPress={() => router.push("/notifications")} />
          <NavRow icon="help-buoy-outline" label="Support & help" onPress={() => router.push("/support")} />
        </Surface>

        <SectionHeader title="Security" />
        <Surface style={{ gap: 4 }}>
          <ToggleRow
            label="Biometric approvals"
            value={sec?.biometricEnabled ?? true}
            onChange={(v) => void patch({ security: { biometricEnabled: v } })}
          />
          <ToggleRow
            label="Login alerts"
            value={sec?.loginAlerts ?? true}
            onChange={(v) => void patch({ security: { loginAlerts: v } })}
          />
          <Row
            label="Authenticator app (TOTP)"
            value={<StatusBadge status={sec?.totpEnabled ? "active" : "pending"} />}
          />
          <NavRow icon="finger-print-outline" label="Manage passkeys" onPress={() => router.push("/passkeys")} />
          <Text style={[type.dim, { fontSize: 12 }]}>
            TOTP setup stays on the web dashboard. This device also locks with your fingerprint or
            face on every app start.
          </Text>
        </Surface>
        <Button title="Lock account instantly" variant="danger" onPress={lockAccount} />

        <SectionHeader title="Notifications" />
        <Surface style={{ gap: 4 }}>
          <ToggleRow
            label="Transactions"
            value={notif?.transactions ?? true}
            onChange={(v) => void patch({ notifications: { transactions: v } })}
          />
          <ToggleRow
            label="Security"
            value={notif?.security ?? true}
            onChange={(v) => void patch({ notifications: { security: v } })}
          />
          <ToggleRow
            label="Price alerts"
            value={notif?.priceAlerts ?? false}
            onChange={(v) => void patch({ notifications: { priceAlerts: v } })}
          />
          <ToggleRow
            label="Product updates"
            value={notif?.product ?? false}
            onChange={(v) => void patch({ notifications: { product: v } })}
          />
        </Surface>

        <ErrorNote message={error} />

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
    gap: spacing.md,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
});
