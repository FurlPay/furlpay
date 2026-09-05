import React, { memo, useCallback } from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useTheme } from "@/lib/design";
import { useI18n } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";
import { FurlStatusBadge, type MoneyStatus } from "./Status";

// ---------------------------------------------------------------------------
// Money display.
//
// One rule runs through all of it: DIRECTION IS NEVER COLOUR ALONE. Every
// credit/debit carries an explicit +/- sign as well as its hue, because roughly
// 1 in 12 men cannot separate the red from the green, and "did money leave my
// account" is not a question the UI may leave to hue.
// ---------------------------------------------------------------------------

export interface FurlBalanceProps {
  /** Major units. Formatting (grouping, decimals) comes from the locale. */
  amount: number;
  currency?: string;
  /** Set for a token balance; switches to token formatting rules. */
  tokenSymbol?: string;
  label?: string;
  /** Privacy toggle — renders •••• and announces "balance hidden". */
  hidden?: boolean;
  onToggleHidden?: () => void;
  /** Secondary line, e.g. an approximate fiat value of a token balance. */
  secondary?: string;
  size?: "hero" | "compact";
  style?: StyleProp<ViewStyle>;
}

export function FurlBalance({
  amount,
  currency = "USD",
  tokenSymbol,
  label,
  hidden,
  onToggleHidden,
  secondary,
  size = "hero",
  style,
}: FurlBalanceProps) {
  const t = useTheme();
  const s = useStyles();
  const i18n = useI18n();

  const formatted = tokenSymbol
    ? i18n.formatToken(amount, tokenSymbol)
    : i18n.formatCurrency(amount, currency);

  // •••• is not the same length as the real value, which is the point: the
  // masked width must not leak the magnitude of the balance.
  const shown = hidden ? "••••••" : formatted;

  const body = (
    <View style={[s.balance, style]}>
      {label ? <Text style={[t.type("dim"), { color: t.colors.textDim }]}>{label}</Text> : null}
      <View style={s.balanceRow}>
        <Text
          style={t.type(size === "hero" ? "amount" : "amountSmall")}
          // The formatted string is what a sighted user reads; give the screen
          // reader the same thing rather than the raw float.
          accessibilityLabel={hidden ? i18n.t("a11y.balanceHidden") : formatted}
          numberOfLines={1}
          adjustsFontSizeToFit={size === "hero"}
          minimumFontScale={0.6}
        >
          {shown}
        </Text>
        {onToggleHidden ? (
          <Ionicons
            name={hidden ? "eye-off-outline" : "eye-outline"}
            size={t.component.icon.md}
            color={t.colors.textDim}
          />
        ) : null}
      </View>
      {secondary && !hidden ? (
        <Text style={[t.type("dim"), { color: t.colors.textDim }]}>{secondary}</Text>
      ) : null}
    </View>
  );

  if (!onToggleHidden) return body;

  return (
    <Pressable
      onPress={() => {
        haptic.select();
        onToggleHidden();
      }}
      accessibilityRole="button"
      accessibilityLabel={hidden ? i18n.t("money.showBalance") : i18n.t("money.hideBalance")}
      hitSlop={8}
    >
      {body}
    </Pressable>
  );
}

export interface FurlTransactionRowProps {
  title: string;
  subtitle?: string;
  /** Signed major units. Negative renders as a debit. */
  amount: number;
  currency?: string;
  tokenSymbol?: string;
  status?: MoneyStatus;
  icon?: keyof typeof Ionicons.glyphMap;
  timestamp?: string | number | Date;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * One row of financial history.
 *
 * `memo`'d deliberately — this is the component that renders 200 times in a
 * scrolling list, and it is one of the few places in the app where memoization
 * is measurably worth its own cost. (Most components are not; blanket
 * memoization just adds comparison work.)
 */
export const FurlTransactionRow = memo(function FurlTransactionRow({
  title,
  subtitle,
  amount,
  currency = "USD",
  tokenSymbol,
  status,
  icon,
  timestamp,
  onPress,
  style,
  testID,
}: FurlTransactionRowProps) {
  const t = useTheme();
  const s = useStyles();
  const i18n = useI18n();

  const isCredit = amount >= 0;
  const magnitude = Math.abs(amount);
  const value = tokenSymbol
    ? i18n.formatToken(magnitude, tokenSymbol)
    : i18n.formatCurrency(magnitude, currency);
  // The sign is part of the STRING, not just the colour.
  const signed = `${isCredit ? "+" : "−"}${value}`;
  const when = timestamp ? i18n.formatRelative(timestamp) : undefined;

  // One label for the whole row. Without `accessible`, TalkBack stops on the
  // title, then the subtitle, then the amount as three separate nodes, and the
  // user has to assemble the transaction themselves.
  const a11y = [title, subtitle, signed, status ? i18n.t(`status.${status}`) : null, when]
    .filter(Boolean)
    .join(", ");

  const content = (
    <View style={[s.row, style]}>
      {icon ? (
        <View style={s.rowIcon}>
          <Ionicons name={icon} size={t.component.icon.md} color={t.colors.textDim} />
        </View>
      ) : null}
      <View style={s.rowBody}>
        <Text style={t.type("bodyStrong")} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[t.type("dim"), { color: t.colors.textDim }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={s.rowTail}>
        <Text
          style={[
            t.type("amountSmall"),
            { color: isCredit ? t.colors.credit : t.colors.text },
          ]}
          numberOfLines={1}
        >
          {signed}
        </Text>
        {status ? <FurlStatusBadge status={status} compact /> : null}
      </View>
    </View>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={a11y}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={({ pressed }) => [pressed && { opacity: 0.7 }]}
    >
      {content}
    </Pressable>
  );
});

export interface FurlAssetRowProps {
  symbol: string;
  name: string;
  /** Held amount in token units. */
  balance: number;
  /** Fiat value of the holding. */
  fiatValue?: number;
  currency?: string;
  /** Fractional change, e.g. 0.0234 for +2.34%. */
  change?: number;
  logo?: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export const FurlAssetRow = memo(function FurlAssetRow({
  symbol,
  name,
  balance,
  fiatValue,
  currency = "USD",
  change,
  logo,
  onPress,
  style,
}: FurlAssetRowProps) {
  const t = useTheme();
  const s = useStyles();
  const i18n = useI18n();

  const up = (change ?? 0) >= 0;
  // Arrow glyph carries the direction for anyone who cannot use the colour.
  const changeText =
    change === undefined ? null : `${up ? "▲" : "▼"} ${i18n.formatPercent(Math.abs(change))}`;

  const a11y = [
    `${name} (${symbol})`,
    i18n.formatToken(balance, symbol),
    fiatValue !== undefined ? i18n.formatCurrency(fiatValue, currency) : null,
    change !== undefined ? `${up ? "up" : "down"} ${i18n.formatPercent(Math.abs(change))}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const content = (
    <View style={[s.row, style]}>
      {logo ?? (
        <View style={s.rowIcon}>
          <Text style={[t.type("caption"), { color: t.colors.textDim }]}>
            {symbol.slice(0, 3).toUpperCase()}
          </Text>
        </View>
      )}
      <View style={s.rowBody}>
        <Text style={t.type("bodyStrong")} numberOfLines={1}>
          {symbol}
        </Text>
        <Text style={[t.type("dim"), { color: t.colors.textDim }]} numberOfLines={1}>
          {name}
        </Text>
      </View>
      <View style={s.rowTail}>
        <Text style={t.type("amountSmall")} numberOfLines={1}>
          {i18n.formatToken(balance, symbol, 4)}
        </Text>
        <View style={s.assetSub}>
          {fiatValue !== undefined ? (
            <Text style={[t.type("caption"), { color: t.colors.textDim }]}>
              {i18n.formatCurrency(fiatValue, currency)}
            </Text>
          ) : null}
          {changeText ? (
            <Text
              style={[t.type("caption"), { color: up ? t.colors.chartUp : t.colors.chartDown }]}
            >
              {changeText}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={a11y}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={({ pressed }) => [pressed && { opacity: 0.7 }]}
    >
      {content}
    </Pressable>
  );
});

/**
 * One line of a fee/quote summary.
 *
 * `emphasis` marks the line the user actually decides on (the total). Values
 * ellipsize in the MIDDLE so both ends of a long identifier stay readable.
 */
export function FurlSummaryRow({
  label,
  value,
  emphasis,
  tone,
  onPressValue,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: "default" | "warning" | "danger" | "success";
  onPressValue?: () => void;
}) {
  const t = useTheme();
  const s = useStyles();
  const color =
    tone === "warning"
      ? t.colors.warning
      : tone === "danger"
        ? t.colors.accentText
        : tone === "success"
          ? t.colors.primaryText
          : t.colors.text;

  const valueNode = (
    <Text
      style={[t.type(emphasis ? "bodyStrong" : "body"), s.summaryValue, { color }]}
      numberOfLines={1}
      ellipsizeMode="middle"
    >
      {value}
    </Text>
  );

  return (
    <View style={s.summaryRow} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[t.type("dim"), s.summaryLabel, { color: t.colors.textDim }]} numberOfLines={1}>
        {label}
      </Text>
      {onPressValue ? (
        <Pressable onPress={onPressValue} style={s.summaryValueWrap} hitSlop={6}>
          {valueNode}
        </Pressable>
      ) : (
        valueNode
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  balance: { gap: 4 },
  balanceRow: { flexDirection: "row", alignItems: "center", gap: t.spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.component.row.gap,
    minHeight: t.component.row.minHeight,
    paddingVertical: t.component.row.paddingY,
  },
  rowIcon: {
    width: t.component.avatar.md,
    height: t.component.avatar.md,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: { flex: 1, gap: 2 },
  rowTail: { alignItems: "flex-end", gap: 4 },
  assetSub: { flexDirection: "row", alignItems: "center", gap: 6 },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: t.spacing.sm,
    paddingVertical: 4,
  },
  summaryLabel: { flexShrink: 0, maxWidth: "55%" },
  summaryValueWrap: { flex: 1 },
  summaryValue: { flex: 1, textAlign: "right" },
}));
