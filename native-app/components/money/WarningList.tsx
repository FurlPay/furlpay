import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WARNING_COLOR, type MoneyWarning } from "@/lib/warnings";
import { colors, radius, spacing, type } from "@/lib/theme";

// Renders the disclosures a rail produced, in the order it produced them.
//
// It holds no policy of its own: what is a warning, and how severe, is decided
// in lib (swapWarnings / sendWarnings) where it can be unit-tested. This file
// only decides what "danger" looks like — and it looks the same on every money
// screen, which is the point of sharing it.

export function WarningList({ warnings }: { warnings: MoneyWarning[] }) {
  if (!warnings.length) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      {warnings.map((w) => (
        <View
          key={w.id}
          style={[styles.warning, { borderColor: WARNING_COLOR[w.level] + "55" }]}
          accessibilityRole="alert"
        >
          <Ionicons
            name={
              w.level === "danger"
                ? "alert-circle"
                : w.level === "warn"
                  ? "warning"
                  : "information-circle"
            }
            size={16}
            color={WARNING_COLOR[w.level]}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.warningTitle, { color: WARNING_COLOR[w.level] }]}>{w.title}</Text>
            <Text style={type.dim}>{w.detail}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  warning: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  warningTitle: { fontSize: 13, fontWeight: "700" },
});
