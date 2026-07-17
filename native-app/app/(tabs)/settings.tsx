import React, { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { api, API_BASE, ApiError } from "@/lib/api";
import { shortUid } from "@/lib/avatar";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, ErrorNote, Field, Screen, SectionHeader, Sheet, StatusBadge, Surface } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { VerifiedBadge } from "@/components/VerifiedBadge";

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

/** A stacked, tappable profile row: label on top, value below, chevron/hint at
 *  the right. Used for editable / navigable profile fields. */
function FieldRow({
  label,
  value,
  hint,
  onPress,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  onPress?: () => void;
}) {
  const content = (
    <View style={styles.fieldRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.dim, { fontSize: 12 }]}>{label}</Text>
        {typeof value === "string" ? (
          <Text style={type.body} numberOfLines={1}>
            {value}
          </Text>
        ) : (
          value
        )}
      </View>
      {hint}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textFaint} /> : null}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.7 }}>
      {content}
    </Pressable>
  ) : (
    content
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
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);

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

  const openNameEditor = () => {
    setNameDraft(profile?.name ?? "");
    setError(null);
    setNameOpen(true);
  };

  const saveName = async () => {
    const next = nameDraft.trim();
    if (!next || next === profile?.name) return setNameOpen(false);
    setNameBusy(true);
    try {
      await api("/profile", { method: "PATCH", body: { name: next } });
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await qc.invalidateQueries({ queryKey: ["profile"] });
      // The name shows on Home + the drawer too — refresh those.
      await qc.invalidateQueries({ queryKey: ["overview"] });
      setNameOpen(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setNameBusy(false);
    }
  };

  const copyUid = async () => {
    if (!profile) return;
    await Clipboard.setStringAsync(shortUid(profile.id));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Plan upgrade: the BACKEND maps the plan to a trusted server-side Stripe
  // price and returns the hosted Checkout URL (never a client-supplied price).
  // The Stripe webhook — not this redirect — is what actually flips the tier;
  // we just refetch the profile on return.
  const upgradePlan = async () => {
    setPlanBusy(true);
    setError(null);
    try {
      const res = await api<{ url: string; sandbox?: boolean }>("/billing/checkout", {
        method: "POST",
        body: { plan: "pro" },
      });
      if (res.url) await WebBrowser.openBrowserAsync(res.url);
      await qc.invalidateQueries({ queryKey: ["profile"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setPlanBusy(false);
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

  const sec = profile?.security;
  const notif = profile?.notifications;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title="Profile" />
        <Surface style={{ gap: 0 }}>
          {/* Identity header */}
          <View style={styles.profileHeader}>
            <Avatar name={profile?.name} email={profile?.email} size={52} ring />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={[type.h2, { fontSize: 17, flexShrink: 1 }]} numberOfLines={1}>
                  {profile?.name ?? "Your account"}
                </Text>
                {profile ? <VerifiedBadge verified={profile.kycStatus === "verified"} size={16} /> : null}
              </View>
              {profile?.email ? (
                <Text style={type.dim} numberOfLines={1}>
                  {profile.email}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.hr} />
          <FieldRow label="Display name" value={profile?.name ?? "—"} onPress={openNameEditor} />
          <View style={styles.hr} />
          {/* Email change is a sensitive identity operation (OTP to the new
              address) — handled on the web for now; shown read-only here. */}
          <FieldRow label="Email" value={profile?.email ?? "—"} />
          <View style={styles.hr} />
          {/* Region drives compliance/limits — not self-editable in-app. */}
          <FieldRow label="Region" value={profile?.region ?? "—"} />
          <View style={styles.hr} />
          <FieldRow
            label="Plan"
            value={profile?.tier ?? "—"}
            hint={
              profile?.tier === "Standard" ? (
                <Text style={{ color: colors.neon, fontWeight: "700", fontSize: 13 }}>
                  {planBusy ? "…" : "Upgrade"}
                </Text>
              ) : undefined
            }
            onPress={profile?.tier === "Standard" ? () => void upgradePlan() : undefined}
          />
          <View style={styles.hr} />
          <FieldRow
            label="Identity verification"
            value={<StatusBadge status={profile?.kycStatus ?? "unknown"} />}
          />
          <View style={styles.hr} />
          <FieldRow
            label="FurlPay UID"
            value={profile ? shortUid(profile.id) : "—"}
            hint={
              <Ionicons
                name={copied ? "checkmark" : "copy-outline"}
                size={16}
                color={copied ? colors.neon : colors.textDim}
              />
            }
            onPress={() => void copyUid()}
          />
        </Surface>

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

        <SectionHeader title="Devices" />
        <Surface style={{ gap: 4 }}>
          <NavRow icon="watch-outline" label="FurlPay Watch" onPress={() => router.push("/watch")} />
          <Text style={[type.dim, { fontSize: 12 }]}>
            Balances, card freeze, Guardian alarms, and voice on your Wear OS watch.
          </Text>
        </Surface>

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
          {/* No hardcoded fallback — a stale literal (this said "2.0.0" at v2.2.0)
              is worse than an honest dash. */}
          <Row label="App version" value={`${Constants.expoConfig?.version ?? "—"} (native)`} />
          <Row label="API" value={API_BASE.replace("https://", "")} />
        </Surface>

        <Button title="Sign out" variant="danger" onPress={() => void signOut()} />

        {/* Google Play requires in-app account deletion for any app that lets
            users create an account. The screen states what is erased and what
            is retained BEFORE the user confirms. */}
        <Button
          title="Delete account"
          variant="secondary"
          onPress={() => router.push("/delete-account")}
        />
        <Text style={[type.dim, { textAlign: "center", color: colors.textFaint }]}>
          FurlPay — stablecoin payments, cards & investing
        </Text>
      </ScrollView>

      <Sheet open={nameOpen} title="Display name" onClose={() => setNameOpen(false)}>
        <View style={{ gap: spacing.md }}>
          <Field
            label="Your name"
            value={nameDraft}
            onChangeText={setNameDraft}
            autoFocus
            maxLength={50}
            placeholder="Your name"
          />
          <ErrorNote message={error} />
          <Button
            title="Save changes"
            loading={nameBusy}
            disabled={!nameDraft.trim() || nameDraft.trim() === profile?.name}
            onPress={() => void saveName()}
          />
        </View>
      </Sheet>
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
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 11,
  },
  hr: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
});
