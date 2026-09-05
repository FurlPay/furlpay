import React from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles, useTheme } from "@/lib/design";
import { useI18n } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";
import { FurlButton, FurlIconButton, FurlSecondaryButton } from "./Button";

/** The page ground. Every route's outermost element. */
export function FurlScreen({
  children,
  style,
  /** Set false for a screen that draws its own edge-to-edge content. */
  safe = true,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  safe?: boolean;
}) {
  const t = useTheme();
  const Container = safe ? SafeAreaView : View;
  return (
    <Container style={[{ flex: 1, backgroundColor: t.colors.bg }, style]}>{children}</Container>
  );
}

export function FurlCard({
  children,
  style,
  onPress,
  accessibilityLabel,
  /** Raises the card off the page. Dark mode leans on the border instead. */
  raised,
  padded = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
  raised?: boolean;
  padded?: boolean;
}) {
  const t = useTheme();
  const s = useStyles();
  const body = (
    <View
      style={[
        s.card,
        padded && { padding: t.component.card.padding },
        raised ? t.elevation("sm") : null,
        style,
      ]}
    >
      {children}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [pressed && { opacity: 0.85 }]}
    >
      {body}
    </Pressable>
  );
}

export function FurlSectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  const t = useTheme();
  const s = useStyles();
  return (
    <View style={s.sectionHeader}>
      {/* `header` role lets a screen reader user jump between sections rather
          than swiping through every row of the one they are in. */}
      <Text style={t.type("h2")} accessibilityRole="header">
        {title}
      </Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={[t.type("callout"), { color: t.colors.primaryText }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function FurlTopBar({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  const t = useTheme();
  const s = useStyles();
  const { t: tr } = useI18n();
  return (
    <View style={s.topBar}>
      {onBack ? (
        <FurlIconButton icon="chevron-back" onPress={onBack} accessibilityLabel={tr("a11y.back")} />
      ) : (
        <View style={{ width: t.touchTarget.min }} />
      )}
      <View style={s.topBarTitle}>
        <Text style={t.type("h3")} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text style={[t.type("caption"), { color: t.colors.textDim }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={s.topBarRight}>{right ?? <View style={{ width: t.touchTarget.min }} />}</View>
    </View>
  );
}

/**
 * Bottom sheet.
 *
 * `onRequestClose` is wired so the Android hardware back button dismisses it —
 * without that, back exits the whole screen behind the sheet, which on a
 * confirmation sheet means leaving a half-finished payment.
 */
export function FurlBottomSheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const t = useTheme();
  const s = useStyles();
  const { t: tr } = useI18n();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={open}
      transparent
      animationType={t.reduceMotion ? "fade" : "slide"}
      onRequestClose={onClose}
      // Announces the sheet as a modal so a screen reader traps focus inside it
      // rather than reading the page underneath.
      accessibilityViewIsModal
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[s.backdrop, { backgroundColor: t.colors.scrim }]}
      >
        <Pressable
          style={{ flex: 1 }}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={tr("common.close")}
        />
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, t.spacing.md) }]}>
          <View style={s.handle} />
          <View style={s.sheetHeader}>
            <Text style={t.type("h2")} accessibilityRole="header">
              {title}
            </Text>
            <FurlIconButton
              icon="close"
              size="sm"
              onPress={onClose}
              accessibilityLabel={tr("common.close")}
            />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: t.spacing.sm, paddingBottom: t.spacing.md }}
          >
            {children}
          </ScrollView>
          {footer}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Modal dialog for a decision that must be made now.
 *
 * `destructive` swaps the confirm button to danger tone AND makes Cancel the
 * visually dominant choice, so the safe option is the easy one.
 */
export function FurlDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  destructive,
  loading,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
  loading?: boolean;
}) {
  const t = useTheme();
  const s = useStyles();
  const { t: tr } = useI18n();

  return (
    <Modal
      visible={open}
      transparent
      animationType={t.reduceMotion ? "none" : "fade"}
      onRequestClose={onCancel}
      accessibilityViewIsModal
      statusBarTranslucent
    >
      <View style={[s.backdrop, s.dialogBackdrop, { backgroundColor: t.colors.scrim }]}>
        <View style={s.dialog} accessible accessibilityRole="alert">
          <Text style={t.type("h2")} accessibilityRole="header">
            {title}
          </Text>
          {body ? (
            <Text style={[t.type("body"), { color: t.colors.textDim }]}>{body}</Text>
          ) : null}
          <View style={{ gap: t.spacing.sm, marginTop: t.spacing.sm }}>
            <FurlButton
              title={confirmLabel ?? tr("common.confirm")}
              onPress={onConfirm}
              tone={destructive ? "danger" : "primary"}
              loading={loading}
              feedback={destructive ? "warning" : "tap"}
            />
            <FurlSecondaryButton
              title={cancelLabel ?? tr("common.cancel")}
              onPress={onCancel}
              disabled={loading}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Segmented control. Selection is announced, not just coloured. */
export function FurlSegmented<T extends string>({
  options,
  value,
  onChange,
  labels,
  style,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const s = useStyles();
  return (
    <View style={[s.segmented, style]} accessibilityRole="tablist">
      {options.map((o) => {
        const active = value === o;
        return (
          <Pressable
            key={o}
            onPress={() => {
              if (active) return;
              haptic.select();
              onChange(o);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[
              s.segment,
              { minHeight: t.touchTarget.min - 8 },
              active && { backgroundColor: t.colors.surface },
            ]}
          >
            <Text
              style={[
                t.type("callout"),
                { color: active ? t.colors.text : t.colors.textDim, fontWeight: "700" },
              ]}
              numberOfLines={1}
            >
              {labels?.[o] ?? o}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.colors.surface,
    borderColor: t.colors.border,
    borderWidth: 1,
    borderRadius: t.component.card.radius,
    gap: t.component.card.gap,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: t.spacing.sm,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    minHeight: t.component.topBar.height,
    paddingHorizontal: t.spacing.sm,
    backgroundColor: t.colors.bg,
  },
  topBarTitle: { flex: 1, alignItems: "center" },
  topBarRight: { minWidth: t.touchTarget.min, alignItems: "flex-end" },
  backdrop: { flex: 1, justifyContent: "flex-end" },
  dialogBackdrop: { justifyContent: "center", alignItems: "center", padding: t.spacing.lg },
  sheet: {
    backgroundColor: t.colors.surface,
    borderTopLeftRadius: t.component.sheet.radius,
    borderTopRightRadius: t.component.sheet.radius,
    borderColor: t.colors.border,
    borderWidth: 1,
    paddingHorizontal: t.component.sheet.padding,
    paddingTop: t.spacing.sm,
    maxHeight: "85%",
  },
  handle: {
    width: t.component.sheet.handleWidth,
    height: t.component.sheet.handleHeight,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.borderStrong,
    alignSelf: "center",
    marginBottom: t.spacing.sm,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: t.spacing.sm,
  },
  dialog: {
    width: "100%",
    maxWidth: t.component.dialog.maxWidth,
    backgroundColor: t.colors.surface,
    borderColor: t.colors.border,
    borderWidth: 1,
    borderRadius: t.component.dialog.radius,
    padding: t.component.dialog.padding,
    gap: t.spacing.sm,
  },
  segmented: {
    flexDirection: "row",
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: t.radius.pill,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    borderRadius: t.radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
}));
