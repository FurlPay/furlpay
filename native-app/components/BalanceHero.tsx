import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { timeAgo, usd } from "@/lib/format";
import { colors, radius, spacing } from "@/lib/theme";
import { useBalancesHidden } from "@/lib/privacy/balanceVisibility";
import { useI18n } from "@/lib/i18n";
import type { Overview } from "@/lib/types";

// ---------------------------------------------------------------------------
// The balance hero — the native counterpart of the web dashboard's `.app-hero`
// card (apps/web/src/app/globals.css), rebuilt in the MOBILE palette: emerald
// rather than the web's crimson, because green is this app's primary
// (lib/theme.ts) and a red-tinted balance card reads as a loss on a phone.
//
// WHY A GRADIENT AND NOT A FLAT SURFACE. Everything else on this screen is a
// flat dark card. The single gradient is what makes the balance the one thing
// the eye lands on first, without needing to be bigger than it already is.
//
// WHY expo-linear-gradient AND NOT expo-blur. Real frosted glass on Android
// needs `expo-blur`, a NEW NATIVE MODULE — adding it invalidates the signed
// build that is currently on the device and forces a full rebuild before
// anything here can be seen. The frosted rows below are translucent white over
// the gradient, which is the same effect at this opacity and costs nothing.
// If a true blur is wanted later it is a drop-in replacement for `frost`.
//
// NO PERCENTAGE CHANGE. /api/overview returns netWorth and a breakdown and
// nothing historical (lib/types.ts), so there is no honest way to render
// "+2.4%". A made-up delta on a balance card is indistinguishable from a real
// one, so the row is absent until the server can answer it.
// ---------------------------------------------------------------------------

interface Props {
  overview?: Overview;
  loading?: boolean;
  /** Timestamp of the cached snapshot, when this is served offline. */
  cachedAt?: number;
  onAddMoney: () => void;
}

/**
 * The mask.
 *
 * Deliberately a FIXED width that is not the width of the real figure. A
 * mask sized to the value ("$12,345.67" -> "••••••••••") leaks the magnitude
 * of the balance to exactly the person standing behind the user that the
 * toggle exists to defeat.
 */
const MASK = "••••••";

export function BalanceHero({ overview, loading, cachedAt, onAddMoney }: Props) {
  const [hidden, toggleHidden] = useBalancesHidden();
  const { t: tr } = useI18n();

  /** Every money figure on this card goes through here, so none can be
   *  forgotten when the toggle flips. */
  const money = (value: number | undefined): string =>
    hidden ? MASK : value === undefined ? "—" : usd(value);

  // Matches the web dashboard's own definition: what is actually spendable is
  // the on-chain plus fiat side, not the invested side.
  const available = overview ? overview.breakdown.crypto + overview.breakdown.fiat : 0;

  return (
    <LinearGradient
      colors={["#0F3D2E", "#0A211B", "#08090A"]}
      start={{ x: 1, y: 0 }}
      end={{ x: 0.1, y: 1 }}
      style={styles.hero}
    >
      {/* Depth. Two soft discs bleeding off the corners give the flat gradient
          a light source; they are decorative and must never take a touch. */}
      <View style={[styles.orb, styles.orbTop]} pointerEvents="none" />
      <View style={[styles.orb, styles.orbBottom]} pointerEvents="none" />

      <View style={styles.headRow}>
        <Text style={styles.label}>
          Est. total value
          {cachedAt ? `  ·  cached ${timeAgo(cachedAt)}` : ""}
        </Text>
        {overview ? (
          <View style={styles.frostPill}>
            <Text style={styles.frostPillText} numberOfLines={1}>
              {overview.user.tier} · {overview.user.region}
            </Text>
          </View>
        ) : null}
      </View>

      <Text
        style={styles.total}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        allowFontScaling={false}
        accessibilityLabel={
          hidden
            ? tr("a11y.balanceHidden")
            : overview
              ? `Total value ${usd(overview.netWorth)}`
              : "Total value not loaded"
        }
      >
        {hidden ? MASK : overview ? usd(overview.netWorth) : loading ? "· · ·" : "—"}
      </Text>

      <View style={styles.frostRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.frostLabel}>Available balance</Text>
          <Text style={styles.frostValue} numberOfLines={1}>
            {money(overview ? available : undefined)}
          </Text>
        </View>
        {/* The toggle lives on the hero because that is where the number the
            user wants gone actually is. Generous hitSlop: it is reached in a
            hurry, often one-handed, usually because somebody just walked up. */}
        <Pressable
          onPress={toggleHidden}
          hitSlop={16}
          style={({ pressed }) => [styles.eyeBtn, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel={hidden ? tr("money.showBalance") : tr("money.hideBalance")}
        >
          <Ionicons
            name={hidden ? "eye-off-outline" : "eye-outline"}
            size={20}
            color="rgba(255,255,255,0.75)"
          />
        </Pressable>
        <Pressable
          onPress={onAddMoney}
          style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel="Add money"
        >
          <Ionicons name="add" size={22} color="#000000" />
        </Pressable>
      </View>

      {/* Masked with the headline, not separately: three figures that sum to
          the hidden total are the hidden total. */}
      <View style={styles.statRow}>
        <Stat label="On-chain" value={overview?.breakdown.crypto} hidden={hidden} />
        <Stat label="Fiat" value={overview?.breakdown.fiat} hidden={hidden} />
        <Stat label="Invest" value={overview?.breakdown.equities} hidden={hidden} />
      </View>
    </LinearGradient>
  );
}

function Stat({ label, value, hidden }: { label: string; value?: number; hidden?: boolean }) {
  const shown = hidden ? MASK : value === undefined ? "—" : usd(value);
  return (
    <View
      style={styles.stat}
      accessible
      // The screen reader gets the mask too. Announcing the real figure while
      // the screen shows dots defeats the toggle for anyone using VoiceOver
      // with audio out loud.
      accessibilityLabel={`${label}: ${hidden ? "hidden" : value === undefined ? "unavailable" : usd(value)}`}
    >
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {shown}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  eyeBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  hero: {
    borderRadius: 26,
    padding: spacing.md + 4,
    gap: spacing.sm + 2,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    // Clips the decorative orbs to the card's radius.
    overflow: "hidden",
    ...Platform.select({
      android: { elevation: 8 },
      default: {
        shadowColor: colors.neon,
        shadowOpacity: 0.28,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
      },
    }),
  },
  orb: { position: "absolute", borderRadius: 999 },
  orbTop: {
    width: 190,
    height: 190,
    top: -96,
    right: -54,
    backgroundColor: "rgba(0,229,153,0.16)",
  },
  orbBottom: {
    width: 140,
    height: 140,
    bottom: -78,
    left: -40,
    backgroundColor: "rgba(0,229,153,0.07)",
  },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  label: { color: "rgba(255,255,255,0.7)", fontSize: 13, flexShrink: 1 },
  frostPill: {
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: "50%",
  },
  frostPillText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  total: {
    color: colors.text,
    fontSize: 44,
    fontWeight: "800",
    letterSpacing: -1.4,
    includeFontPadding: false,
  },
  frostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingVertical: 10,
    paddingLeft: spacing.md,
    paddingRight: 10,
  },
  frostLabel: { color: "rgba(255,255,255,0.6)", fontSize: 11 },
  frostValue: { color: colors.text, fontSize: 17, fontWeight: "700", letterSpacing: -0.3 },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  statRow: { flexDirection: "row", gap: spacing.sm },
  stat: {
    flex: 1,
    minWidth: 0,
    gap: 1,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  statLabel: { color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: "600" },
  statValue: { color: colors.text, fontSize: 14, fontWeight: "700", letterSpacing: -0.2 },
});
