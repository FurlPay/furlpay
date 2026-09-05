import React, { useCallback } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useTheme } from "@/lib/design";
import { haptic } from "@/lib/haptics";

// ---------------------------------------------------------------------------
// Buttons.
//
// Three components rather than one with a `variant` grab-bag, because the three
// have genuinely different APIs: a primary/secondary button is a labelled
// control, an icon button is an unlabelled one (and therefore MUST carry an
// accessibility label, which the type system enforces below).
// ---------------------------------------------------------------------------

export type FurlButtonTone = "primary" | "neutral" | "danger" | "ghost";
export type FurlButtonSize = "sm" | "md" | "lg";

export interface FurlButtonProps {
  title: string;
  onPress: () => void;
  tone?: FurlButtonTone;
  size?: FurlButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** Full-width by default; set false for an inline button. */
  stretch?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Overrides the label for screen readers when the visible text is terse. */
  accessibilityLabel?: string;
  /** Spoken after the label — what happens, not what it looks like. */
  accessibilityHint?: string;
  /**
   * Haptic fired on press. Defaults to `tap`. A button that moves money should
   * pass "commit" so the phone's response matches the weight of the action.
   */
  feedback?: keyof typeof haptic | "none";
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function FurlButton({
  title,
  onPress,
  tone = "primary",
  size = "md",
  disabled,
  loading,
  stretch = true,
  icon,
  accessibilityLabel,
  accessibilityHint,
  feedback = "tap",
  style,
  testID,
}: FurlButtonProps) {
  const t = useTheme();
  const s = useStyles();

  // Guard the press, not just the visuals. A disabled-looking button that still
  // fires onPress is how a double-submit becomes two transfers.
  const handle = useCallback(() => {
    if (disabled || loading) return;
    if (feedback !== "none") haptic[feedback]();
    onPress();
  }, [disabled, loading, feedback, onPress]);

  const fill =
    tone === "primary"
      ? t.colors.primary
      : tone === "danger"
        // `accent` is the FILL role and is guaranteed to carry `onAccent`.
        // `danger` is the text/icon role and is too light here.
        ? t.colors.accent
        : tone === "ghost"
          ? "transparent"
          : t.colors.surfaceRaised;

  const label =
    tone === "primary"
      ? t.colors.onPrimary
      : tone === "danger"
        ? t.colors.onAccent
        : t.colors.text;

  const height =
    size === "sm"
      ? t.component.button.heightSm
      : size === "lg"
        ? t.component.button.heightLg
        : t.component.button.heightMd;

  return (
    <Pressable
      testID={testID}
      onPress={handle}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      // `busy` matters: without it a loading button announces as an ordinary
      // one and gets tapped again by a screen-reader user who has no spinner
      // to look at.
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      style={({ pressed }) => [
        s.base,
        {
          backgroundColor: fill,
          // Height is a MINIMUM, not a fixed value: at a 1.6x font scale the
          // label is taller than 48dp and a fixed height would clip it.
          minHeight: height,
          alignSelf: stretch ? "stretch" : "flex-start",
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
        tone === "ghost" && { borderWidth: 1, borderColor: t.colors.border },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={label} />
      ) : (
        <View style={s.inner}>
          {icon ? <Ionicons name={icon} size={t.component.icon.md} color={label} /> : null}
          <Text style={[t.type(size === "sm" ? "callout" : "bodyStrong"), { color: label }]}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/** The quieter sibling. Same API; `tone` is fixed. */
export function FurlSecondaryButton(props: Omit<FurlButtonProps, "tone">) {
  return <FurlButton {...props} tone="neutral" />;
}

export interface FurlIconButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /**
   * REQUIRED — not optional like it is on FurlButton.
   *
   * An icon button has no visible text, so without this a screen reader
   * announces "button" and nothing else. Making it required is the only way to
   * stop unlabelled icon buttons from reaching production.
   */
  accessibilityLabel: string;
  accessibilityHint?: string;
  tone?: "neutral" | "primary" | "danger";
  size?: FurlButtonSize;
  disabled?: boolean;
  feedback?: keyof typeof haptic | "none";
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function FurlIconButton({
  icon,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  tone = "neutral",
  size = "md",
  disabled,
  feedback = "tap",
  style,
  testID,
}: FurlIconButtonProps) {
  const t = useTheme();
  const s = useStyles();

  const handle = useCallback(() => {
    if (disabled) return;
    if (feedback !== "none") haptic[feedback]();
    onPress();
  }, [disabled, feedback, onPress]);

  const box = size === "sm" ? 36 : size === "lg" ? 56 : t.touchTarget.min;
  const glyph =
    tone === "primary" ? t.colors.primaryText : tone === "danger" ? t.colors.accentText : t.colors.text;

  return (
    <Pressable
      testID={testID}
      onPress={handle}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      // Even at size="sm" the TAPPABLE area stays >= 48dp via hitSlop. The
      // visual can be small; the target must not be.
      hitSlop={Math.max(0, (t.touchTarget.min - box) / 2)}
      style={({ pressed }) => [
        s.icon,
        {
          width: box,
          height: box,
          backgroundColor: tone === "neutral" ? t.colors.surfaceRaised : "transparent",
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <Ionicons name={icon} size={size === "sm" ? 16 : t.component.icon.lg} color={glyph} />
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  base: {
    borderRadius: t.component.button.radius,
    paddingHorizontal: t.component.button.paddingX,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.component.button.gap,
  },
  icon: {
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
}));
