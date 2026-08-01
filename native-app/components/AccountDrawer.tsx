import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { shortUid } from "@/lib/avatar";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Avatar } from "@/components/Avatar";
import { VerifiedBadge } from "@/components/VerifiedBadge";

// ---------------------------------------------------------------------------
// Left-side account drawer, opened by tapping the home-screen avatar.
//
// Identity-first (this is a fintech): avatar, name, verified email, a short
// COPYABLE display-only UID, and a verified badge — then navigation to screens
// that ACTUALLY EXIST, then a secure sign-out and the real app version.
//
// It renders NO secret: no JWT, no session id, no mnemonic, no FCM token, no raw
// UUID. The visible UID is shortUid() — a one-way, display-only id that cannot
// authenticate. Wallet backup/recovery stays behind its own biometric gate in
// the Wallet screen; the drawer only links there.
// ---------------------------------------------------------------------------

interface Profile {
  id: string;
  name: string;
  email: string | null;
  kycStatus: string;
  emailVerified?: boolean;
  googleLinked?: boolean;
}

type Dest =
  | { kind: "route"; icon: keyof typeof Ionicons.glyphMap; label: string; to: string }
  | { kind: "url"; icon: keyof typeof Ionicons.glyphMap; label: string; url: string };

// Every route below is a real screen in app/ — no dead links. Privacy & legal
// lives on the web (furlpay.com/legal), so it opens in the browser.
const ITEMS: Dest[] = [
  { kind: "route", icon: "person-outline", label: "Profile", to: "/(tabs)/settings" },
  { kind: "route", icon: "receipt-outline", label: "Payments & activity", to: "/transactions" },
  { kind: "route", icon: "swap-horizontal-outline", label: "Swaps & bridges", to: "/swaps" },
  { kind: "route", icon: "card-outline", label: "Cards", to: "/(tabs)/cards" },
  { kind: "route", icon: "airplane-outline", label: "Travel & bookings", to: "/travel" },
  { kind: "route", icon: "notifications-outline", label: "Notifications", to: "/notifications" },
  { kind: "route", icon: "shield-checkmark-outline", label: "Security & passkeys", to: "/security" },
  { kind: "route", icon: "wallet-outline", label: "Self-custodial wallet", to: "/wallet" },
  { kind: "route", icon: "help-buoy-outline", label: "Help & support", to: "/support" },
  { kind: "url", icon: "document-text-outline", label: "Privacy & legal", url: "https://furlpay.com/legal/privacy" },
];

export function AccountDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const signOut = useAuth((s) => s.signOut);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelW = Math.min(width * 0.85, 360);

  const tx = useRef(new Animated.Value(-panelW)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(open);
  const [copied, setCopied] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<Profile>("/profile"),
    enabled: open,
  });

  // Slide + fade in/out. Unmount only after the close animation completes so the
  // panel doesn't blink away.
  useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(tx, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(tx, { toValue: -panelW, duration: 190, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 0, duration: 190, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, panelW]);

  // Android hardware back closes the drawer instead of leaving the screen.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  if (!mounted) return null;

  const go = (to: string) => {
    onClose();
    // Let the close animation start before navigating so the transition reads.
    setTimeout(() => router.push(to as never), 60);
  };
  const openUrl = (url: string) => {
    onClose();
    void Linking.openURL(url);
  };
  const doSignOut = () => {
    onClose();
    void signOut();
  };

  const uid = profile ? shortUid(profile.id) : null;
  const verified = profile?.kycStatus === "verified";

  const copyUid = async () => {
    if (!uid) return;
    await Clipboard.setStringAsync(uid);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal transparent visible statusBarTranslucent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: fade }]}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close account menu" />
        </Animated.View>

        <Animated.View
          style={[
            styles.panel,
            {
              width: panelW,
              transform: [{ translateX: tx }],
              paddingTop: insets.top + spacing.lg,
              paddingBottom: insets.bottom + spacing.md,
            },
          ]}
        >
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: spacing.lg }}>
            {/* Identity header */}
            <View style={{ gap: spacing.sm, paddingHorizontal: spacing.md }}>
              <Avatar name={profile?.name} email={profile?.email} size={56} ring />
              <View style={{ gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={[type.h2, { fontSize: 18, flexShrink: 1 }]} numberOfLines={1}>
                    {profile?.name || "Your account"}
                  </Text>
                  {profile ? <VerifiedBadge verified={verified} size={16} /> : null}
                </View>
                {profile?.email ? (
                  <Text style={type.dim} numberOfLines={1}>
                    {profile.email}
                  </Text>
                ) : null}
              </View>

              <View style={styles.badgeRow}>
                {uid ? (
                  <Pressable
                    onPress={() => void copyUid()}
                    accessibilityRole="button"
                    accessibilityLabel={`Copy account id ${uid}`}
                    style={({ pressed }) => [styles.uidChip, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.uidText}>{copied ? "Copied" : uid}</Text>
                    <Ionicons
                      name={copied ? "checkmark" : "copy-outline"}
                      size={12}
                      color={colors.textDim}
                    />
                  </Pressable>
                ) : null}
              </View>
            </View>

            <View style={styles.divider} />

            {/* Navigation — real routes only */}
            <View>
              {ITEMS.map((it) => (
                <Pressable
                  key={it.label}
                  accessibilityRole="button"
                  onPress={() => (it.kind === "route" ? go(it.to) : openUrl(it.url))}
                  style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surfaceRaised }]}
                >
                  <Ionicons name={it.icon} size={20} color={colors.textDim} />
                  <Text style={[type.body, { flex: 1 }]}>{it.label}</Text>
                  <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
                </Pressable>
              ))}
            </View>

            <View style={styles.divider} />

            <Pressable
              accessibilityRole="button"
              onPress={doSignOut}
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surfaceRaised }]}
            >
              <Ionicons name="log-out-outline" size={20} color={colors.accent} />
              <Text style={[type.body, { flex: 1, color: colors.accent, fontWeight: "600" }]}>Sign out</Text>
            </Pressable>

            <Text style={styles.version}>
              FurlPay v{Constants.expoConfig?.version ?? "2.1.0"}
            </Text>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(0,0,0,0.6)" },
  panel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderRightColor: colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap", marginTop: 2 },
  uidChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  uidText: { color: colors.textDim, fontFamily: "monospace", fontSize: 12, fontWeight: "700" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: spacing.md },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 13,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  version: {
    ...type.dim,
    fontSize: 11,
    textAlign: "center",
    color: colors.textFaint,
    marginTop: spacing.sm,
  },
});
