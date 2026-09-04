import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { concernText, deviceIntegrity } from "@/lib/security/deviceIntegrity";
import { colors, radius, spacing } from "@/lib/theme";

// ---------------------------------------------------------------------------
// A warning on the wallet screen when this device looks like a bad place to
// keep a private key.
//
// A WARNING, NOT A BLOCK, AND THAT IS A DELIBERATE CHOICE. Refusing to open the
// wallet on a rooted phone would be security theatre in both directions: the
// attacker patches the check, and the legitimate power user — who rooted their
// own phone and knows exactly what that means — is locked out of their own
// funds by a check that cannot be appealed. What the honest version does is
// tell them what is true and let them decide.
//
// IT RENDERS NOTHING WHEN NOTHING FIRED. There is no green "device secure"
// state, because this check cannot establish that: it reads a handful of build
// strings that any rooted device can rewrite. A reassuring tick would be a
// claim the code has no basis for, and the user would then read its ABSENCE as
// meaningful too. Silence is the accurate output.
// ---------------------------------------------------------------------------

export function IntegrityBanner() {
  // Nothing here changes while the app runs — the OS build strings are fixed
  // for the life of the process — so this is computed once rather than on
  // every render of a screen the user scrolls.
  const report = useMemo(() => deviceIntegrity(), []);

  if (report.concerns.length === 0) return null;

  return (
    <View style={styles.card} accessibilityRole="alert">
      <View style={styles.head}>
        <Ionicons name="warning-outline" size={16} color={colors.warning} />
        <Text style={styles.title}>Check this device before storing keys here</Text>
      </View>

      {report.concerns.map((concern) => {
        const copy = concernText(concern);
        return (
          <View key={concern} style={styles.item}>
            <Text style={styles.itemTitle}>{copy.title}</Text>
            <Text style={styles.itemDetail}>{copy.detail}</Text>
          </View>
        );
      })}

      {/* The limits of the check, stated on the check itself. A user who trusts
          this more than it deserves is worse off than one who never saw it. */}
      <Text style={styles.footnote}>
        This is a local check on what the system reports about itself, so it can be defeated. It
        can&rsquo;t confirm a device is safe — only flag signs that it isn&rsquo;t.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "#1A1405",
    borderWidth: 1,
    borderColor: "#3D2E08",
  },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { color: colors.warning, fontSize: 14, fontWeight: "700", flex: 1 },
  item: { gap: 2 },
  itemTitle: { color: colors.text, fontSize: 13, fontWeight: "700" },
  itemDetail: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  footnote: { color: colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: 2 },
});
