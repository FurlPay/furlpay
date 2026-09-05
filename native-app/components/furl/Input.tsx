import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useTheme } from "@/lib/design";
import { decimalSeparator, useI18n } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";

export interface FurlInputProps extends Omit<TextInputProps, "style"> {
  label?: string;
  /** Shown under the field in danger tone; also sets the a11y invalid state. */
  error?: string | null;
  /** Shown under the field when there is no error. */
  hint?: string;
  right?: React.ReactNode;
  clearable?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function FurlInput({
  label,
  error,
  hint,
  right,
  clearable,
  value,
  onChangeText,
  style,
  testID,
  ...rest
}: FurlInputProps) {
  const t = useTheme();
  const s = useStyles();
  const { t: tr } = useI18n();
  const [focused, setFocused] = useState(false);

  const showClear = !!clearable && !!value && String(value).length > 0;
  const hasAccessory = !!right || showClear;

  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Text style={[t.type("dim"), { color: t.colors.textDim }]}>{label}</Text> : null}
      <View style={s.wrap}>
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          placeholderTextColor={t.colors.textFaint}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          // iOS-only and it collides with `right`; we draw our own below.
          clearButtonMode="never"
          accessibilityLabel={label}
          // Lets a screen reader say "invalid entry" instead of leaving the
          // error text as an unrelated line of prose further down the screen.
          aria-invalid={!!error}
          style={[
            s.input,
            {
              borderColor: error
                ? t.colors.danger
                : focused
                  ? t.colors.primaryText
                  : t.colors.border,
              // A focus ring, not just a colour change — a 1px hue shift is not
              // a visible focus indicator for keyboard/switch users.
              borderWidth: focused || error ? 2 : 1,
              paddingRight: hasAccessory ? (showClear ? 34 : 0) + (right ? 44 : 0) + 8 : t.spacing.md,
            },
          ]}
          {...rest}
        />
        {hasAccessory ? (
          <View style={s.accessory}>
            {showClear ? (
              <Pressable
                onPress={() => onChangeText?.("")}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={tr("a11y.clearSearch")}
                style={s.clear}
              >
                <Ionicons name="close-circle" size={18} color={t.colors.textFaint} />
              </Pressable>
            ) : null}
            {right}
          </View>
        ) : null}
      </View>
      {error ? (
        <Text style={[t.type("caption"), { color: t.colors.accentText }]} accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function FurlSearchBar({
  value,
  onChangeText,
  placeholder,
  onVoice,
  autoFocus,
  style,
  testID,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  /** Renders the mic affordance. Omit where speech is not available. */
  onVoice?: () => void;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <FurlInput
      testID={testID}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder ?? tr("common.search")}
      accessibilityLabel={tr("common.search")}
      autoFocus={autoFocus}
      autoCorrect={false}
      autoCapitalize="none"
      returnKeyType="search"
      clearable
      style={style}
      right={
        onVoice ? (
          <Pressable
            onPress={() => {
              haptic.tap();
              onVoice();
            }}
            hitSlop={10}
            accessibilityRole="button"
            // Voice input is an ALTERNATIVE to the keyboard, never a
            // replacement: the field stays fully typeable if speech is
            // unavailable or the user declines the mic permission.
            accessibilityLabel="Search by voice"
            style={{ width: 40, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="mic-outline" size={t.component.icon.lg} color={t.colors.textDim} />
          </Pressable>
        ) : undefined
      }
    />
  );
}

export interface FurlAmountInputProps {
  /** Canonical value as a machine string ("12.5"). Empty string when blank. */
  value: string;
  onChangeValue: (v: string) => void;
  /** Ticker or currency shown beside the field. */
  symbol: string;
  label?: string;
  error?: string | null;
  hint?: string;
  /** Fills the field with the spendable maximum. */
  onMax?: () => void;
  /** Secondary readout, e.g. the fiat equivalent. */
  secondary?: string;
  maxDecimals?: number;
  autoFocus?: boolean;
  testID?: string;
}

/**
 * Amount entry.
 *
 * Two problems this solves that a plain TextInput does not:
 *
 * 1. THE DECIMAL SEPARATOR. A German or French keyboard produces "," and a
 *    field that only accepts "." either refuses the decimal outright or — far
 *    worse — drops it, turning 1,50 into 150. The displayed value uses the
 *    locale's separator; the value handed to `onChangeValue` is always a
 *    machine-parseable string with ".".
 *
 * 2. PRECISION. Input is capped at the asset's decimals, so a user cannot type
 *    an amount with more precision than the asset can represent and have it
 *    silently rounded somewhere further down the stack.
 */
export function FurlAmountInput({
  value,
  onChangeValue,
  symbol,
  label,
  error,
  hint,
  onMax,
  secondary,
  maxDecimals = 6,
  autoFocus,
  testID,
}: FurlAmountInputProps) {
  const t = useTheme();
  const s = useStyles();
  const { locale, t: tr } = useI18n();
  const sep = useMemo(() => decimalSeparator(locale), [locale]);

  // Canonical "." -> the separator this user's keyboard actually emits.
  const display = useMemo(() => (sep === "." ? value : value.replace(".", sep)), [value, sep]);

  const handle = useCallback(
    (raw: string) => {
      // Accept either separator regardless of locale — a user with a US
      // keyboard on a German phone types "." and means a decimal point.
      let next = raw.replace(/[.,]/g, ".").replace(/[^\d.]/g, "");

      // Collapse multiple points: keep the first, drop the rest.
      const first = next.indexOf(".");
      if (first !== -1) {
        next = next.slice(0, first + 1) + next.slice(first + 1).replace(/\./g, "");
      }
      // Cap the fractional part at the asset's precision.
      const [whole, frac] = next.split(".");
      next = frac === undefined ? whole : `${whole}.${frac.slice(0, maxDecimals)}`;

      onChangeValue(next);
    },
    [maxDecimals, onChangeValue]
  );

  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={[t.type("dim"), { color: t.colors.textDim }]}>{label}</Text> : null}
      <View
        style={[
          s.amountWrap,
          { borderColor: error ? t.colors.danger : t.colors.border, borderWidth: error ? 2 : 1 },
        ]}
      >
        <TextInput
          testID={testID}
          value={display}
          onChangeText={handle}
          // "decimal-pad" rather than "numeric": it exposes the separator key
          // and omits the characters an amount can never contain.
          keyboardType="decimal-pad"
          inputMode="decimal"
          placeholder={`0${sep}00`}
          placeholderTextColor={t.colors.textFaint}
          autoFocus={autoFocus}
          accessibilityLabel={label ?? tr("money.amount")}
          aria-invalid={!!error}
          style={[t.type("amount"), s.amountField]}
        />
        <View style={s.amountTail}>
          <Text style={[t.type("h3"), { color: t.colors.textDim }]}>{symbol}</Text>
          {onMax ? (
            <Pressable
              onPress={() => {
                haptic.select();
                onMax();
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={tr("money.max")}
              style={s.maxChip}
            >
              <Text style={[t.type("caption"), { color: t.colors.primaryText, fontWeight: "700" }]}>
                {tr("money.max")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {secondary ? (
        <Text style={[t.type("dim"), { color: t.colors.textDim }]}>{secondary}</Text>
      ) : null}
      {error ? (
        <Text style={[t.type("caption"), { color: t.colors.accentText }]} accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: { position: "relative", justifyContent: "center" },
  input: {
    backgroundColor: t.colors.surface,
    borderRadius: t.component.input.radius,
    color: t.colors.text,
    paddingHorizontal: t.component.input.paddingX,
    paddingVertical: 12,
    // Minimum, not fixed — see the note in Button.tsx about font scaling.
    minHeight: t.component.input.height,
    fontSize: Math.round(16 * t.fontScale),
  },
  accessory: {
    position: "absolute",
    right: 4,
    height: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  clear: { width: 30, alignItems: "center", justifyContent: "center" },
  amountWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    backgroundColor: t.colors.surface,
    borderRadius: t.component.input.radius,
    paddingHorizontal: t.component.input.paddingX,
    paddingVertical: t.spacing.sm,
  },
  amountField: { flex: 1, color: t.colors.text, paddingVertical: 6 },
  amountTail: { flexDirection: "row", alignItems: "center", gap: t.spacing.sm },
  maxChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.primarySoft,
  },
}));
