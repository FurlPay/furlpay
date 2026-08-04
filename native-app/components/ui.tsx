import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing, type } from "@/lib/theme";

// Small shared UI kit — OLED black surfaces, neon primary. Kept in one file
// so screens import from a single place.

export function Screen({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <SafeAreaView style={[styles.screen, style]}>{children}</SafeAreaView>;
}

export function Surface({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.surface, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  style,
  icon,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "accent" | "light" | "outline";
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: React.ReactNode;
}) {
  const bg =
    variant === "primary"
      ? colors.neon
      : variant === "danger"
        ? colors.accentDeep
        : variant === "accent"
          ? colors.accent
          : variant === "light"
            ? "#FFFFFF"
            : variant === "outline"
              ? "transparent"
              : colors.surfaceRaised;
  const fg = variant === "primary" ? colors.onNeon : variant === "light" ? "#000000" : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      /* Declared on the PRIMITIVE, not at each call site. Every screen builds
         its buttons from this one, so a role here labels hundreds of controls
         that were previously invisible to VoiceOver and TalkBack — a screen
         reader announced them as plain text with no hint they could be tapped.
         `busy` matters too: without it a loading button reads as an ordinary
         one and gets tapped again. */
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        variant === "outline" && styles.buttonOutline,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon}
          <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * A text field, optionally with something on its right edge.
 *
 * `right` is rendered INSIDE the input's border rather than beside it, so the
 * control reads as one field with an affordance rather than a field plus a
 * loose button. The input keeps its own padding on the right so long text
 * scrolls under the accessory instead of behind it.
 */
export function Field(
  props: TextInputProps & {
    label?: string;
    right?: React.ReactNode;
    /** Cross-platform clear button. See the note below on clearButtonMode. */
    clearable?: boolean;
  }
) {
  const { label, style, right, clearable, value, onChangeText, ...rest } = props;

  /* `clearButtonMode` is iOS-ONLY — Android has never rendered it, so a field
     relying on it is inconsistent across the two platforms this app ships to.
     It also draws in the same place as `right`, so the two would overlap. When
     either `clearable` or `right` is in play we draw our own, which fixes the
     platform gap and the collision at once. */
    const showClear = !!clearable && !!value && String(value).length > 0;
  const hasAccessory = !!right || showClear;

  if (!hasAccessory) {
    return (
      <View style={{ gap: 6 }}>
        {label ? <Text style={type.dim}>{label}</Text> : null}
        <TextInput
          placeholderTextColor={colors.textFaint}
          style={[styles.input, style]}
          value={value}
          onChangeText={onChangeText}
          {...rest}
        />
      </View>
    );
  }

  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={type.dim}>{label}</Text> : null}
      <View style={styles.fieldWrap}>
        <TextInput
          placeholderTextColor={colors.textFaint}
          style={[
            styles.input,
            /* Reserve room for however many accessories are actually shown, so
               long text scrolls under them rather than being covered. */
            { paddingRight: (showClear ? 34 : 0) + (right ? 44 : 0) + 8 },
            style,
          ]}
          value={value}
          onChangeText={onChangeText}
          clearButtonMode="never"
          {...rest}
        />
        <View style={styles.fieldRight}>
          {showClear ? (
            <Pressable
              onPress={() => onChangeText?.("")}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              style={styles.fieldClear}
            >
              <Text style={styles.fieldClearGlyph}>×</Text>
            </Pressable>
          ) : null}
          {right}
        </View>
      </View>
    </View>
  );
}

export function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={type.h2}>{title}</Text>
      {right}
    </View>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={[type.body, { fontWeight: "600" }]}>{title}</Text>
      {subtitle ? <Text style={[type.dim, { textAlign: "center" }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const palette: Record<string, { bg: string; fg: string }> = {
    settled: { bg: colors.neonSoft, fg: colors.neon },
    confirmed: { bg: colors.neonSoft, fg: colors.neon },
    pending: { bg: "#2A230A", fg: colors.warning },
    escrow: { bg: "#0A1A2A", fg: "#4CC2FF" },
    declined: { bg: "#2A0A0A", fg: colors.accent },
    cancelled: { bg: "#2A0A0A", fg: colors.accent },
    frozen: { bg: "#0A1A2A", fg: "#4CC2FF" },
    active: { bg: colors.neonSoft, fg: colors.neon },
  };
  const c = palette[status] ?? { bg: colors.surfaceRaised, fg: colors.textDim };
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={{ color: c.fg, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>
        {status}
      </Text>
    </View>
  );
}

/** Bottom sheet — the native counterpart of the web app's Modal component. */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.sheetBackdrop}
      >
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={styles.sheetPanel}>
          <View style={styles.sheetHeader}>
            <Text style={type.h2}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8} style={styles.sheetClose}>
              <Ionicons name="close" size={18} color={colors.textDim} />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.lg }}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Segmented pill selector — mirrors the web's rounded-pill tab strips. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <Pressable
          key={o}
          onPress={() => onChange(o)}
          style={[styles.segment, value === o && { backgroundColor: colors.accent }]}
        >
          <Text
            style={{
              color: value === o ? "#FFFFFF" : colors.textDim,
              fontWeight: "700",
              fontSize: 13,
              textTransform: "capitalize",
            }}
          >
            {labels?.[o] ?? o}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** −/value/+ stepper for a small bounded integer (guests, nights, quantity). */
export function Stepper({
  label,
  value,
  min = 1,
  max = 99,
  onChange,
  suffix,
}: {
  label?: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  /** e.g. "guest"/"guests" — pluralized by value for the readout + a11y. */
  suffix?: [one: string, many: string];
}) {
  const readout = suffix ? `${value} ${value === 1 ? suffix[0] : suffix[1]}` : String(value);
  // Clamp, and never fire a redundant onChange at a bound.
  const set = (v: number) => {
    const clamped = Math.max(min, Math.min(max, v));
    if (clamped !== value) onChange(clamped);
  };
  return (
    <View style={styles.stepperRow}>
      {label ? <Text style={type.body}>{label}</Text> : null}
      <View style={styles.stepper}>
        <Pressable
          onPress={() => set(value - 1)}
          disabled={value <= min}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label ?? "value"}`}
          style={({ pressed }) => [styles.stepperBtn, (value <= min || pressed) && { opacity: 0.4 }]}
        >
          <Ionicons name="remove" size={18} color={colors.text} />
        </Pressable>
        <Text style={styles.stepperValue} accessibilityLabel={readout}>
          {readout}
        </Text>
        <Pressable
          onPress={() => set(value + 1)}
          disabled={value >= max}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label ?? "value"}`}
          style={({ pressed }) => [styles.stepperBtn, (value >= max || pressed) && { opacity: 0.4 }]}
        >
          <Ionicons name="add" size={18} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

/** Key/value line inside quote & fee summaries. */
export function SummaryRow({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[type.dim, styles.summaryKey]} numberOfLines={1}>
        {k}
      </Text>
      {/* Values can be long (a bk_<uuid> id, an x402 proof). Take the remaining
          width, right-align, and ellipsize in the MIDDLE so both ends of an id
          stay readable instead of running off-screen. */}
      <Text
        style={[type.body, styles.summaryVal, bold && { fontWeight: "700" }]}
        numberOfLines={1}
        ellipsizeMode="middle"
      >
        {v}
      </Text>
    </View>
  );
}

/**
 * Honest disclosure for flows that render as a completed action but have no
 * server settlement behind them yet (e.g. banking Send/Convert/Direct). Without
 * it a preview success screen reads as a real transfer. Warning-toned so it is
 * visually distinct from a live confirmation.
 */
export function PreviewBanner({ text }: { text?: string }) {
  return (
    <View style={styles.previewBanner} accessibilityRole="alert">
      <Ionicons name="flask-outline" size={14} color={colors.warning} />
      <Text style={styles.previewText}>
        {text ?? "Preview — this flow isn't live yet, so no real money will move."}
      </Text>
    </View>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.errorNote}>
      <Text style={{ color: colors.accent, fontSize: 13 }}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  surface: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  button: {
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonOutline: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  buttonInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  buttonText: { fontSize: 16, fontWeight: "700" },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
  },
  /* The field and its accessory sit on one row; the accessory floats over the
     input's right padding so the border stays a single unbroken rounded rect. */
  fieldWrap: {
    position: "relative",
    justifyContent: "center",
  },
  fieldRight: {
    position: "absolute",
    right: 4,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  fieldClear: {
    width: 30,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldClearGlyph: {
    color: colors.textFaint,
    fontSize: 20,
    lineHeight: 22,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  empty: { alignItems: "center", gap: 6, paddingVertical: spacing.xl },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  errorNote: {
    backgroundColor: "#2A0A0A",
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheetPanel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    maxHeight: "85%",
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    borderRadius: radius.pill,
    paddingVertical: 8,
    alignItems: "center",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 3,
    gap: spacing.sm,
  },
  summaryKey: { flexShrink: 0, maxWidth: "55%" },
  summaryVal: { flex: 1, textAlign: "right" },
  stepperRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    padding: 3,
    gap: 2,
  },
  stepperBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  stepperValue: { minWidth: 76, textAlign: "center", color: colors.text, fontWeight: "700", fontSize: 14 },
  previewBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.sm,
    backgroundColor: "#2A230A",
    borderRadius: radius.md,
  },
  previewText: { color: colors.warning, fontSize: 12, flex: 1 },
});
