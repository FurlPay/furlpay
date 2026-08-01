import React, { useEffect, useRef } from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  PANEL_CAPTION_STYLE,
  PANEL_HEAD_STYLE,
  PANEL_STYLE,
} from "@/components/money/ValuePanel";
import { shortAddress } from "@/lib/format";
import type { RecentRecipient } from "@/lib/send/recipients";
import { CHAINS, type ChainId } from "@/lib/swap/assets";
import { colors, radius, spacing } from "@/lib/theme";

// ---------------------------------------------------------------------------
// Recipient entry — the send screen's counterpart to the swap screen's amount
// panel, and the same surface: identical card, identical caption, identical
// pill treatment for its actions.
//
// HOLD ANYWHERE ON THIS CARD TO PASTE. A wallet address is never typed; it
// arrives on the clipboard, and the default alternative is a tap-to-focus,
// long-press-inside-the-input, wait-for-the-Android-menu, hit-"Paste" sequence
// on a 42-character string where a single wrong character loses the money. One
// sustained press on the whole card replaces all of it. The gesture is
// discoverable because the empty state says so in words, and it is not the ONLY
// way in — the Paste button next to it does the same thing with a tap, which is
// what a screen-reader user and anyone with limited motor control needs.
//
// Once the field HAS content the empty-state overlay is removed, so a long
// press inside the input reaches Android's own text-selection menu. That is the
// platform behaviour a user expects when editing existing text, and taking it
// away to keep our gesture would be worse than not having the gesture.
//
// WHAT IS PASTED IS PARSED, NOT TRUSTED. The caller runs the clipboard through
// the same parser as the QR scanner (lib/qr.ts), so a payment link resolves to
// its payee and an EIP-681 contract-call URI resolves to the payee rather than
// to the token contract — the case that would otherwise send funds somewhere
// unrecoverable.
//
// THE VERIFICATION BLOCK IS DELIBERATELY UNIFORM. It would be easy to highlight
// the first and last characters, and that is precisely the habit address
// poisoning exploits. Instead the address is grouped in fours, in monospace, at
// one colour, so comparing it character by character is actually feasible.
// ---------------------------------------------------------------------------

interface Props {
  value: string;
  onChangeText: (v: string) => void;
  /**
   * Chain of the selected source balance — decides the expected address form.
   *
   * Undefined until an asset is chosen. The field then asks for a "wallet
   * address" generically rather than promising `0x…`, because which form is
   * correct genuinely is not known yet.
   */
  chain?: ChainId;
  error?: string | null;
  valid?: boolean;
  editable?: boolean;
  /** Reads the clipboard. Owned by the caller so the read stays in lib. */
  onPaste: () => void;
  onScan: () => void;
  /** Set when the last paste attempt found nothing payable. */
  pasteNotice?: string | null;
  recents?: RecentRecipient[];
  onPickRecent?: (recipient: RecentRecipient) => void;
}

/**
 * Groups of four, so two addresses can actually be compared side by side.
 *
 * An `0x` prefix is held out of the grouping so the 40 hex characters after it
 * fall into ten even blocks. Comparing two grids is possible; comparing two
 * 42-character runs is not, which is the whole reason this exists.
 */
export function grouped(address: string): string {
  const hex = /^0[xX]/.test(address);
  const prefix = hex ? address.slice(0, 2) : "";
  const body = hex ? address.slice(2) : address;
  return `${prefix}${prefix ? " " : ""}${body.replace(/(.{4})/g, "$1 ")}`.trim();
}

export function RecipientInput({
  value,
  onChangeText,
  chain,
  error,
  valid = false,
  editable = true,
  onPaste,
  onScan,
  pasteNotice,
  recents = [],
  onPickRecent,
}: Props) {
  const input = useRef<TextInput>(null);
  const shake = useRef(new Animated.Value(0)).current;
  const previousError = useRef<string | null | undefined>(null);

  // Shake once on a NEW error — never on every keystroke while the error
  // persists, which would punish a user who is mid-correction. Identical
  // behaviour to the amount field, because they are the same kind of mistake.
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

  const hold = () => {
    if (!editable) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPaste();
  };

  const placeholder = !chain ? "Wallet address" : chain === "solana" ? "Base58 address" : "0x…";
  const expected = !chain
    ? "Choose what you're paying with first — that decides the address format."
    : chain === "solana"
      ? "Expected: a Solana base58 address."
      : "Expected: a 0x EVM address.";

  return (
    <Pressable
      onLongPress={hold}
      // Longer than the empty-state overlay below: a hold on the card can land
      // while the user is starting a scroll, and here there may already be an
      // address to overwrite. Where the field is empty there is nothing to
      // lose, so that path stays snappy.
      delayLongPress={500}
      disabled={!editable}
      style={PANEL_STYLE}
      // The children are the accessible elements; the card itself is a gesture
      // shortcut with an equivalent button, so it must not become a node that a
      // screen reader stops on and cannot use.
      accessible={false}
    >
      <View style={PANEL_HEAD_STYLE}>
        <Text style={PANEL_CAPTION_STYLE}>TO</Text>
        <View style={styles.actions}>
          <ActionPill icon="clipboard-outline" label="Paste" onPress={onPaste} disabled={!editable} />
          <ActionPill icon="qr-code-outline" label="Scan" onPress={onScan} disabled={!editable} />
        </View>
      </View>

      <Animated.View style={[styles.inputRow, { transform: [{ translateX }] }]}>
        <TextInput
          ref={input}
          value={value}
          onChangeText={onChangeText}
          editable={editable}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.neon}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          allowFontScaling={false}
          style={[styles.input, error ? { color: colors.accent } : null]}
          accessibilityLabel="Recipient address"
          accessibilityHint={`${expected} Use the Paste button, or hold this card, to paste from the clipboard.`}
        />

        {value ? (
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              onChangeText("");
              input.current?.focus();
            }}
            hitSlop={10}
            disabled={!editable}
            accessibilityRole="button"
            accessibilityLabel="Clear recipient address"
          >
            <Ionicons name="close-circle" size={20} color={colors.textFaint} />
          </Pressable>
        ) : null}

        {/* Empty state only: tap focuses, hold pastes. With content present this
            is unmounted so Android's own selection menu takes the long press. */}
        {!value && editable ? (
          <Pressable
            onPress={() => input.current?.focus()}
            onLongPress={hold}
            delayLongPress={300}
            style={StyleSheet.absoluteFill}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
          />
        ) : null}
      </Animated.View>

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : pasteNotice ? (
        <View style={styles.statusRow} accessibilityRole="alert">
          <Ionicons name="alert-circle-outline" size={14} color={colors.warning} />
          <Text style={[styles.statusText, { color: colors.warning }]}>{pasteNotice}</Text>
        </View>
      ) : valid && chain ? (
        <View style={styles.statusRow}>
          <Ionicons name="checkmark-circle" size={14} color={colors.neon} />
          <Text style={[styles.statusText, { color: colors.neon }]}>
            Valid {CHAINS[chain].name} address
          </Text>
        </View>
      ) : (
        <View style={styles.statusRow}>
          <Ionicons name="finger-print-outline" size={14} color={colors.textFaint} />
          <Text style={styles.statusText}>
            {chain ? "Hold this card to paste, or scan a QR code." : expected}
          </Text>
        </View>
      )}

      {valid && !error ? (
        <View style={styles.verify}>
          <Text style={styles.verifyAddress} selectable allowFontScaling={false}>
            {grouped(value.trim())}
          </Text>
          <Text style={styles.verifyNote}>
            Compare every character — payments cannot be reversed.
          </Text>
        </View>
      ) : null}

      {recents.length && onPickRecent ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.recentsLabel}>RECENT</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.sm }}
            keyboardShouldPersistTaps="handled"
          >
            {recents.map((r) => {
              const active = r.address.toLowerCase() === value.trim().toLowerCase();
              return (
                <Pressable
                  key={r.address}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    onPickRecent(r);
                  }}
                  disabled={!editable}
                  style={({ pressed }) => [
                    styles.recentChip,
                    (active || pressed) && { borderColor: colors.neon },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Send to ${shortAddress(r.address, 6)}, last used with ${r.token}`}
                >
                  <Ionicons name="time-outline" size={13} color={colors.textFaint} />
                  <Text style={styles.recentText}>{shortAddress(r.address, 6)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </Pressable>
  );
}

function ActionPill({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [styles.pill, pressed && { borderColor: colors.neon }]}
      accessibilityRole="button"
      accessibilityLabel={label === "Paste" ? "Paste address from clipboard" : "Scan a QR code"}
    >
      <Ionicons name={icon} size={14} color={colors.textDim} />
      <Text style={styles.pillText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: spacing.sm },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillText: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontFamily: "monospace",
    paddingVertical: 12,
    padding: 0,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusText: { color: colors.textFaint, fontSize: 12, flex: 1 },
  error: { color: colors.accent, fontSize: 13 },
  verify: {
    gap: 4,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  verifyAddress: {
    color: colors.text,
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 20,
    letterSpacing: 0.5,
  },
  verifyNote: { color: colors.textFaint, fontSize: 11 },
  recentsLabel: { color: colors.textFaint, fontSize: 11, fontWeight: "700", letterSpacing: 0.6 },
  recentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recentText: { color: colors.textDim, fontSize: 12, fontWeight: "600", fontFamily: "monospace" },
});
