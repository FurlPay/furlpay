import React, { useEffect, useRef } from "react";
import { Animated, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { announce, makeStyles, useTheme } from "@/lib/design";
import { useI18n } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";
import { FurlButton, FurlSecondaryButton } from "./Button";

// ---------------------------------------------------------------------------
// The states every route owes the user.
//
// A blank screen is not a state — it is the absence of one, and it is
// indistinguishable from a hang. These five cover what a screen can actually be
// doing, and each one says what happened AND what the user can do next.
// ---------------------------------------------------------------------------

/**
 * Skeleton placeholder.
 *
 * A pulsing block, not a spinner. A spinner says "something is happening"; a
 * skeleton says "content of roughly this shape is coming", which stops the
 * layout jumping when it lands.
 *
 * The pulse respects reduced motion — with it on, the block renders static
 * rather than pulsing at 0ms (which would be a hard flicker, not stillness).
 */
export function FurlSkeleton({
  width,
  height = 16,
  radius,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (t.reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, t.reduceMotion]);

  return (
    <Animated.View
      // Hidden from screen readers: a placeholder has nothing to announce, and
      // reading "loading" once per skeleton block is noise.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: width ?? "100%",
          height,
          borderRadius: radius ?? t.radius.sm,
          backgroundColor: t.colors.skeleton,
          opacity: t.reduceMotion ? 1 : pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] }),
        },
        style,
      ]}
    />
  );
}

/** A few skeleton lines shaped like a list. */
export function FurlSkeletonList({ rows = 5 }: { rows?: number }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <View
      style={{ gap: t.spacing.md, padding: t.spacing.md }}
      accessibilityLabel={tr("state.loading")}
      accessibilityRole="progressbar"
    >
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm }}>
          <FurlSkeleton width={40} height={40} radius={t.radius.pill} />
          <View style={{ flex: 1, gap: 6 }}>
            <FurlSkeleton width="60%" height={14} />
            <FurlSkeleton width="35%" height={12} />
          </View>
          <FurlSkeleton width={64} height={14} />
        </View>
      ))}
    </View>
  );
}

interface StateProps {
  title?: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  style?: StyleProp<ViewStyle>;
}

function StateShell({
  icon,
  tint,
  title,
  body,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  role,
  style,
}: StateProps & {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  role?: "alert" | "summary";
}) {
  const t = useTheme();
  const s = useStyles();
  return (
    <View style={[s.shell, style]} accessibilityRole={role} accessible>
      <View style={[s.badge, { backgroundColor: tint + "22" }]}>
        <Ionicons name={icon} size={t.component.icon.xl} color={tint} />
      </View>
      {title ? <Text style={[t.type("h2"), s.center]}>{title}</Text> : null}
      {body ? <Text style={[t.type("body"), s.center, { color: t.colors.textDim }]}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <FurlButton title={actionLabel} onPress={onAction} stretch={false} />
      ) : null}
      {secondaryLabel && onSecondary ? (
        <FurlSecondaryButton title={secondaryLabel} onPress={onSecondary} stretch={false} size="sm" />
      ) : null}
    </View>
  );
}

export function FurlEmptyState(props: StateProps & { icon?: keyof typeof Ionicons.glyphMap }) {
  const { t } = useI18n();
  const theme = useTheme();
  return (
    <StateShell
      icon={props.icon ?? "file-tray-outline"}
      tint={theme.colors.textDim}
      role="summary"
      {...props}
      title={props.title ?? t("state.emptyTitle")}
      body={props.body ?? t("state.emptyBody")}
    />
  );
}

/**
 * Something failed.
 *
 * `role="alert"` so a screen reader announces it without the user having to go
 * looking — an error the user cannot see is an error they cannot recover from.
 */
export function FurlErrorState(props: StateProps & { error?: unknown }) {
  const { t } = useI18n();
  const theme = useTheme();
  const detail =
    props.body ??
    (props.error instanceof Error && props.error.message ? props.error.message : t("state.errorBody"));
  return (
    <StateShell
      icon="alert-circle-outline"
      tint={theme.colors.danger}
      role="alert"
      {...props}
      title={props.title ?? t("state.errorTitle")}
      body={detail}
      actionLabel={props.actionLabel ?? (props.onAction ? t("state.retry") : undefined)}
    />
  );
}

export function FurlOfflineState(props: StateProps) {
  const { t } = useI18n();
  const theme = useTheme();
  return (
    <StateShell
      icon="cloud-offline-outline"
      tint={theme.colors.warning}
      role="alert"
      {...props}
      title={props.title ?? t("state.offlineTitle")}
      body={props.body ?? t("state.offlineBody")}
    />
  );
}

/**
 * The receipt.
 *
 * Fires a success haptic and a screen-reader announcement on mount. Both are
 * load-bearing: this is often the ONLY confirmation that money moved, and a
 * user who cannot see the checkmark still needs to be told.
 */
export function FurlSuccessState({
  announceMessage,
  ...props
}: StateProps & { announceMessage?: string }) {
  const { t } = useI18n();
  const theme = useTheme();
  const title = props.title ?? t("state.successTitle");

  useEffect(() => {
    haptic.success();
    announce(announceMessage ?? title);
    // Mount-only by design: re-announcing on every re-render would talk over
    // the user as they navigate the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <StateShell
      icon="checkmark-circle"
      tint={theme.colors.success}
      role="alert"
      {...props}
      title={title}
    />
  );
}

const useStyles = makeStyles((t) => ({
  shell: {
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.md,
    padding: t.spacing.xl,
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  center: { textAlign: "center" },
}));
