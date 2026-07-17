import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { api, ApiError } from "@/lib/api";
import { securityLevel, levelPresentation, type SecuritySignals } from "@/lib/security";
import { colors, radius, spacing, type } from "@/lib/theme";
import { EmptyState, ErrorNote, Screen, SectionHeader, Surface } from "@/components/ui";

// Security screen — a real-time view of the account's ACTUAL security state.
// Every status is derived from authoritative backend/device data (passkey
// credentials, verified email, linked Google identity, biometric app lock);
// nothing is hardcoded or inferred from the mere existence of a session. Only
// capabilities that genuinely exist get a row — no dead menu items.

interface Profile {
  id: string;
  name: string;
  email: string | null;
  kycStatus: string;
  emailVerified?: boolean;
  googleLinked?: boolean;
  security: {
    biometricEnabled: boolean;
    hardwareKeys: { name: string; addedAt: string }[];
    devices: { name: string; current: boolean }[];
  };
}

/** Small status tick: green when the capability is genuinely on, muted gray
 *  when not configured. Red is reserved for real problems (unused here). */
function StatusTick({ on }: { on: boolean }) {
  return (
    <Ionicons
      name="checkmark-circle"
      size={20}
      color={on ? colors.neon : colors.textFaint}
      accessibilityLabel={on ? "Enabled" : "Not configured"}
    />
  );
}

function AuthRow({
  icon,
  label,
  sub,
  on,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  on: boolean;
  onPress?: () => void;
}) {
  const body = (
    <>
      <Ionicons name={icon} size={20} color={colors.textDim} />
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { fontWeight: "600" }]}>{label}</Text>
        <Text style={type.dim} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <StatusTick on={on} />
      {onPress ? <Ionicons name="chevron-forward" size={15} color={colors.textFaint} /> : null}
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      {body}
    </Pressable>
  ) : (
    <View style={styles.row}>{body}</View>
  );
}

function NavRow({
  icon,
  label,
  sub,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={20} color={colors.textDim} />
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { fontWeight: "600" }]}>{label}</Text>
        {sub ? <Text style={type.dim}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
    </Pressable>
  );
}

export default function Security() {
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<Profile>("/profile"),
  });

  const setBiometric = async (value: boolean) => {
    setError(null);
    try {
      await api("/profile", { method: "PATCH", body: { security: { biometricEnabled: value } } });
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await qc.invalidateQueries({ queryKey: ["profile"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  };

  if (!profile) {
    return (
      <Screen style={{ padding: spacing.md }}>
        <EmptyState title={isLoading ? "Loading…" : "Couldn't load security"} />
      </Screen>
    );
  }

  const sec = profile.security;
  const signals: SecuritySignals = {
    passkey: (sec.hardwareKeys?.length ?? 0) >= 1,
    emailVerified: Boolean(profile.emailVerified),
    biometric: Boolean(sec.biometricEnabled),
  };
  const level = securityLevel(signals);
  const pres = levelPresentation(level);
  const passkeyCount = sec.hardwareKeys?.length ?? 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Security level card */}
        <View style={[styles.levelCard, { borderColor: pres.color }]}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={type.dim}>Security level</Text>
            <Text style={[styles.levelText, { color: pres.color }]}>{pres.label}</Text>
            <Text style={type.dim}>{pres.blurb}</Text>
          </View>
          <Ionicons name="shield-checkmark" size={40} color={pres.color} />
        </View>

        {/* Authentication methods */}
        <SectionHeader title="Authentication methods" />
        <Surface style={{ paddingVertical: 4 }}>
          <AuthRow
            icon="finger-print"
            label="Passkey"
            sub={passkeyCount ? `${passkeyCount} passkey${passkeyCount > 1 ? "s" : ""} registered` : "None yet — add one"}
            on={signals.passkey}
            onPress={() => router.push("/passkeys")}
          />
          <AuthRow
            icon="logo-google"
            label="Google account"
            sub={profile.googleLinked ? "Connected" : "Not connected"}
            on={Boolean(profile.googleLinked)}
          />
          <AuthRow
            icon="mail"
            label="Email address"
            sub={profile.email ?? "Not set"}
            on={signals.emailVerified}
          />
        </Surface>

        {/* Advanced security — real capabilities only */}
        <SectionHeader title="Advanced security" />
        <Surface style={{ paddingVertical: 4 }}>
          <View style={styles.row}>
            <Ionicons name="lock-closed" size={20} color={colors.textDim} />
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { fontWeight: "600" }]}>App lock</Text>
              <Text style={type.dim}>Require biometric to approve sensitive actions</Text>
            </View>
            <Switch
              value={sec.biometricEnabled}
              onValueChange={(v) => void setBiometric(v)}
              trackColor={{ true: colors.neonDeep, false: colors.border }}
            />
          </View>
          <NavRow
            icon="shield-checkmark-outline"
            label="Transaction approvals"
            sub="Passkey / biometric required for card & 3DS approvals"
            onPress={() => router.push("/approvals")}
          />
          <NavRow
            icon="wallet-outline"
            label="Wallet security"
            sub="Backup & recovery — biometric-gated"
            onPress={() => router.push("/wallet")}
          />
          <NavRow
            icon="trash-outline"
            label="Manage account"
            sub="Delete account & data controls"
            onPress={() => router.push("/delete-account")}
          />
        </Surface>

        <ErrorNote message={error} />
        <Text style={styles.footnote}>
          FurlPay never shows your recovery phrase, private keys or session tokens here.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  levelCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  levelText: { fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 13,
    paddingHorizontal: spacing.md,
  },
  footnote: {
    ...type.dim,
    fontSize: 11,
    textAlign: "center",
    color: colors.textFaint,
    marginTop: spacing.sm,
  },
});
