import React, { memo, useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, radius, spacing, type } from "@/lib/theme";

// Travel-document card.
//
// NO FLAG EMOJI. Regional-indicator sequences are unreliable on Android — many
// OEM font stacks ship no flag glyphs at all and fall back to two letters in a
// tofu box, so a card whose identity depends on one renders broken on the
// platform this app ships to first. The country is shown as its ISO alpha-3
// code in a typographic chip, which renders identically everywhere and is what
// appears on the document itself.
//
// The accent is colors.neon (#00E599) — FurlPay's token. A card built to a
// different green would be visibly foreign to every other screen.
//
// The shimmer is a looped translate, NOT an accelerometer tilt: expo-sensors is
// not installed, and adding a native module for a decorative highlight would
// invalidate the signed AAB waiting on Play review.

export type DocumentStatus = "pending" | "verified" | "failed" | "expired";

export interface TravelDocumentView {
  id: string;
  type: string;
  typeLabel: string;
  issuingCountry: string;
  countryName: string;
  documentNumberMasked: string;
  expiresOn: string;
  expiringSoon: boolean;
  expired: boolean;
  status: DocumentStatus;
  chipVerified: boolean;
  label: string | null;
  isPrimary: boolean;
}

interface Props {
  doc: TravelDocumentView;
  onPress?: () => void;
  /** Suppresses the shimmer where many cards are on screen at once. */
  animated?: boolean;
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function PassportCardBase({ doc, onPress, animated = true }: Props) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // A failed or expired document should not look celebratory.
    if (!animated || doc.status !== "verified") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay(2400),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [animated, doc.status, shimmer]);

  const translateX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-260, 260] });

  const statusMeta = STATUS[doc.status];

  return (
    <Pressable
      onPress={() => {
        if (!onPress) return;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [styles.wrap, pressed && onPress ? styles.pressed : null]}
      accessibilityRole={onPress ? "button" : undefined}
      // One coherent sentence rather than eight separate nodes to swipe through.
      accessibilityLabel={[
        doc.label || doc.typeLabel,
        doc.countryName,
        `ending ${doc.documentNumberMasked.replace(/[^\dA-Za-z]/g, "")}`,
        `expires ${formatExpiry(doc.expiresOn)}`,
        statusMeta.label,
        doc.isPrimary ? "primary document" : "",
      ]
        .filter(Boolean)
        .join(", ")}
    >
      <LinearGradient
        colors={["#101A2B", "#0A1220", "#060B14"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        {doc.status === "verified" && animated ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.shimmerTrack, { transform: [{ translateX }, { rotate: "18deg" }] }]}
          >
            <LinearGradient
              colors={["transparent", "rgba(0,229,153,0.10)", "transparent"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        ) : null}

        <View style={styles.head}>
          <View style={styles.countryChip}>
            <Text style={styles.countryCode} allowFontScaling={false}>
              {doc.issuingCountry}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.country} numberOfLines={1}>
              {doc.countryName}
            </Text>
            <Text style={styles.typeLabel} numberOfLines={1}>
              {doc.label || doc.typeLabel}
            </Text>
          </View>
          {doc.isPrimary ? (
            <View style={styles.primaryPill}>
              <Text style={styles.primaryText}>PRIMARY</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.number} allowFontScaling={false}>
          {doc.documentNumberMasked}
        </Text>

        <View style={styles.foot}>
          <View>
            <Text style={styles.footLabel}>VALID UNTIL</Text>
            <Text
              style={[
                styles.footValue,
                doc.expired ? { color: colors.accent } : doc.expiringSoon ? { color: colors.warning } : null,
              ]}
            >
              {formatExpiry(doc.expiresOn)}
            </Text>
          </View>

          <View style={styles.badges}>
            {doc.chipVerified ? (
              <View style={styles.chipBadge}>
                <Ionicons name="wifi" size={11} color={colors.textDim} />
                <Text style={styles.chipText}>CHIP</Text>
              </View>
            ) : null}
            <View style={[styles.statusBadge, { borderColor: statusMeta.color + "55" }]}>
              <Ionicons name={statusMeta.icon} size={12} color={statusMeta.color} />
              <Text style={[styles.statusText, { color: statusMeta.color }]}>
                {statusMeta.label}
              </Text>
            </View>
          </View>
        </View>

        {/* Stated on the card itself, where the user is looking at it. */}
        {doc.expiringSoon && !doc.expired ? (
          <Text style={styles.notice}>
            Many countries require six months&apos; validity on arrival.
          </Text>
        ) : null}
      </LinearGradient>
    </Pressable>
  );
}

const STATUS: Record<
  DocumentStatus,
  { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  verified: { label: "VERIFIED", color: colors.neon, icon: "shield-checkmark" },
  pending: { label: "PENDING", color: colors.warning, icon: "time-outline" },
  failed: { label: "FAILED", color: colors.accent, icon: "close-circle" },
  expired: { label: "EXPIRED", color: colors.accent, icon: "alert-circle" },
};

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, overflow: "hidden" },
  pressed: { opacity: 0.9, transform: [{ scale: 0.995 }] },
  card: {
    padding: spacing.md,
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#1E2A3D",
    overflow: "hidden",
  },
  shimmerTrack: { position: "absolute", top: -40, bottom: -40, width: 90 },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  countryChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  countryCode: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    includeFontPadding: false,
  },
  country: { color: colors.text, fontSize: 15, fontWeight: "700" },
  typeLabel: { color: colors.textDim, fontSize: 11 },
  primaryPill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.neonSoft,
    borderWidth: 1,
    borderColor: colors.neon + "44",
  },
  primaryText: { color: colors.neon, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  number: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "700",
    fontFamily: "monospace",
    letterSpacing: 2,
  },
  foot: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: spacing.sm },
  footLabel: { color: colors.textFaint, fontSize: 9, fontWeight: "700", letterSpacing: 0.8 },
  footValue: { color: colors.text, fontSize: 13, fontWeight: "600", marginTop: 2 },
  badges: { flexDirection: "row", alignItems: "center", gap: 6 },
  chipBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  chipText: { color: colors.textDim, fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  statusText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  notice: { color: colors.warning, fontSize: 11, lineHeight: 15 },
});

export const PassportCard = memo(PassportCardBase);
export default PassportCard;
