import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, radius, spacing, type } from "@/lib/theme";

// Large amount entry with balance-relative shortcuts.
//
// SHARED BY EVERY RAIL THAT TAKES AN AMOUNT (swap, send). One component means
// the two screens cannot drift in how a number is typed, sized, shortcutted or
// rejected — which on a money screen is a correctness property, not a styling
// one. Rail-specific wording arrives through props; nothing here knows what the
// amount is for.
//
// PERCENTAGES ARE COMPUTED FROM THE BALANCE BY THE CALLER, never from the
// displayed string. `lib/money.ts` exists because "0.0000001" passes
// `Number(x) > 0` and then truncates to zero — the bug the Send tab already
// fixed. This component therefore never does arithmetic on its own value; it
// reports a fraction and lets the caller derive the amount from the balance it
// holds.
//
// The value SHRINKS as it grows rather than truncating. A user checking a
// six-figure amount against their balance needs to see all of it; an ellipsis
// on a money screen is a correctness problem, not a layout one.

interface Props {
  value: string;
  onChangeText: (v: string) => void;
  /** Spendable balance in display units, if known. */
  balance?: number;
  balanceSymbol?: string;
  /** Fiat value of the current amount, if quotable. */
  fiatValue?: number;
  /**
   * Replaces the derived "≈ $x" line.
   *
   * Send is denominated in USD, so its secondary line is the TOKEN equivalent
   * rather than a fiat one — restating "$50 ≈ $50" would be noise where a real
   * conversion belongs.
   */
  secondaryText?: string;
  /** Replaces the derived "Balance n SYM" line. */
  balanceText?: string;
  /**
   * Currency glyph rendered before the figure, e.g. "$".
   *
   * Swap amounts are denominated in the asset shown on the panel's own pill, so
   * they need none. Send is denominated in dollars while the pill shows the
   * token it will be paid from — without the glyph the headline figure is
   * genuinely ambiguous, and on a payment screen that ambiguity is a defect.
   */
  prefix?: string;
  error?: string | null;
  editable?: boolean;
  maxLength?: number;
  /** Fraction of balance: 0.25 | 0.5 | 0.75 | 1. */
  onPercent?: (fraction: number) => void;
  autoFocus?: boolean;
  /** Screen-reader name for the field. */
  accessibilityLabel?: string;
}

const PERCENTS: { label: string; fraction: number }[] = [
  { label: "25%", fraction: 0.25 },
  { label: "50%", fraction: 0.5 },
  { label: "75%", fraction: 0.75 },
  { label: "Max", fraction: 1 },
];

/** Font size by digit count — keeps long amounts fully visible. */
function sizeFor(len: number): number {
  if (len <= 6) return 48;
  if (len <= 9) return 40;
  if (len <= 12) return 32;
  return 26;
}

export function AmountInput({
  value,
  onChangeText,
  balance,
  balanceSymbol,
  fiatValue,
  secondaryText,
  balanceText,
  prefix,
  error,
  editable = true,
  maxLength = 20,
  onPercent,
  autoFocus,
  accessibilityLabel = "Amount",
}: Props) {
  const shake = useRef(new Animated.Value(0)).current;
  const previousError = useRef<string | null | undefined>(null);

  // Shake once on a NEW error. Re-shaking on every keystroke while the error
  // persists would punish a user who is mid-correction.
  useEffect(() => {
    if (error && error !== previousError.current) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 50, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 50, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0.5, duration: 40, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 40, useNativeDriver: true }),
      ]).start();
    }
    previousError.current = error;
  }, [error, shake]);

  const translateX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-8, 8] });

  return (
    <View style={{ gap: spacing.sm }}>
      <Animated.View style={[styles.amountRow, { transform: [{ translateX }] }]}>
        {prefix ? (
          <Text
            allowFontScaling={false}
            style={[
              styles.prefix,
              // Tracks the figure's size so the pair always reads as one unit.
              { fontSize: sizeFor(value.length || 1) },
              error ? { color: colors.accent } : null,
            ]}
          >
            {prefix}
          </Text>
        ) : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType="decimal-pad"
          inputMode="decimal"
          editable={editable}
          maxLength={maxLength}
          autoFocus={autoFocus}
          placeholder="0"
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.neon}
          allowFontScaling={false}
          style={[
            styles.amount,
            { fontSize: sizeFor(value.length || 1) },
            error ? { color: colors.accent } : null,
          ]}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={
            balanceText ??
            (balance !== undefined ? `Balance ${balance} ${balanceSymbol ?? ""}` : undefined)
          }
        />
      </Animated.View>

      <View style={styles.metaRow}>
        {/* A non-breaking space, not "": the row must keep its height when
            there is nothing to say, or the whole card jumps as the user types. */}
        <Text style={type.dim} numberOfLines={1}>
          {error
            ? " "
            : (secondaryText ??
              (fiatValue !== undefined
                ? `≈ $${fiatValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                : " "))}
        </Text>
        {balanceText !== undefined ? (
          <Text style={type.dim} numberOfLines={1}>
            {balanceText}
          </Text>
        ) : balance !== undefined ? (
          <Text style={type.dim} numberOfLines={1}>
            Balance {balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}{" "}
            {balanceSymbol ?? ""}
          </Text>
        ) : null}
      </View>

      {onPercent && balance !== undefined && balance > 0 ? (
        <View style={styles.percentRow}>
          {PERCENTS.map((p) => (
            <Pressable
              key={p.label}
              onPress={() => {
                void Haptics.selectionAsync();
                onPercent(p.fraction);
              }}
              disabled={!editable}
              style={({ pressed }) => [styles.percentChip, pressed && styles.percentPressed]}
              accessibilityRole="button"
              accessibilityLabel={
                p.fraction === 1 ? "Use maximum balance" : `Use ${p.label} of balance`
              }
            >
              <Text style={styles.percentText}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  amountRow: { flexDirection: "row", alignItems: "center", minHeight: 60 },
  prefix: {
    color: colors.textFaint,
    fontWeight: "800",
    marginRight: 2,
    includeFontPadding: false,
  },
  amount: {
    flex: 1,
    color: colors.text,
    fontWeight: "800",
    padding: 0,
    includeFontPadding: false,
  },
  metaRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  percentRow: { flexDirection: "row", gap: spacing.sm },
  percentChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  percentPressed: { backgroundColor: colors.neonSoft, borderColor: colors.neon },
  percentText: { color: colors.textDim, fontSize: 13, fontWeight: "700" },
  error: { color: colors.accent, fontSize: 13 },
});
