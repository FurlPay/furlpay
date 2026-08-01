import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { MAX_SLIPPAGE_PCT } from "@/lib/swap/useSwap";
import { colors, radius, spacing, type } from "@/lib/theme";

// Slippage ACCEPTANCE CEILING — not a routing parameter.
//
// This is the honest version of a slippage control for this backend. The server
// computes slippagePct from the route it found; SwapExecuteSchema carries no
// price fields at all, so a client cannot ask for a different tolerance and any
// UI implying otherwise would be theatre.
//
// What this DOES do is real: it is the threshold above which the app refuses to
// put a quote behind the biometric prompt. Lowering it from the 5% hard ceiling
// means quotes this user considers bad never reach a confirmable state. The
// hard ceiling still applies underneath — this can tighten it, never loosen it.

export const SLIPPAGE_PRESETS = [0.5, 1, 3, MAX_SLIPPAGE_PCT] as const;

export function SlippageSelector({
  value,
  onChange,
  quoted,
}: {
  /** Current acceptance ceiling, in percent. */
  value: number;
  onChange: (pct: number) => void;
  /** Slippage of the live quote, for immediate comparison. */
  quoted?: number;
}) {
  const breached = quoted !== undefined && quoted > value;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.label}>Maximum slippage you'll accept</Text>
        {quoted !== undefined ? (
          <Text style={[styles.quoted, breached && { color: colors.accent }]}>
            quoted {quoted.toFixed(2)}%
          </Text>
        ) : null}
      </View>

      <View style={styles.row}>
        {SLIPPAGE_PRESETS.map((p) => {
          const active = Math.abs(p - value) < 0.001;
          return (
            <Pressable
              key={p}
              onPress={() => {
                void Haptics.selectionAsync();
                onChange(p);
              }}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Accept up to ${p} percent slippage`}
            >
              <Text style={[styles.chipText, active && { color: colors.onNeon }]}>{p}%</Text>
            </Pressable>
          );
        })}
      </View>

      {breached ? (
        <View style={styles.note} accessibilityRole="alert">
          <Ionicons name="alert-circle" size={14} color={colors.accent} />
          <Text style={[type.dim, { flex: 1, color: colors.accent }]}>
            This route quotes {quoted!.toFixed(2)}% — above your {value}% limit, so it can't be
            confirmed. Try a smaller amount, or raise the limit to at most {MAX_SLIPPAGE_PCT}%.
          </Text>
        </View>
      ) : (
        <Text style={styles.hint}>
          Routing is chosen by the network, not by this setting. Lowering it blocks quotes you'd
          consider bad before they can be confirmed.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  label: { color: colors.textDim, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  quoted: { color: colors.textFaint, fontSize: 12, fontFamily: "monospace" },
  row: { flexDirection: "row", gap: spacing.sm },
  chip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.neon, borderColor: colors.neon },
  chipText: { color: colors.textDim, fontSize: 13, fontWeight: "700" },
  note: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  hint: { color: colors.textFaint, fontSize: 11, lineHeight: 16 },
});
