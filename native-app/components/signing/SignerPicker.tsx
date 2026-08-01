import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { EmptyState } from "@/components/ui";
import { colors, radius, spacing, type } from "@/lib/theme";
import { useAvailableSigners, useConnection } from "@/lib/signing/useSigner";
import type { AccountSigner, PresenceProof } from "@/lib/signing/types";

// ---------------------------------------------------------------------------
// Choose which signer authorises a transaction.
//
// DRIVEN BY THE REGISTRY, NOT A VENDOR LIST. The tempting version hardcodes
// "Ledger · Bluetooth / Trezor · USB / Tangem · NFC" so the screen looks
// complete. Every one of those rows would be a dead end today — no plugin is
// registered, so tapping does nothing — and a picker offering hardware the app
// cannot talk to is a lie told at the exact moment a user is deciding how to
// protect their money.
//
// So this renders what `listSigners()` actually returns. A Ledger row appears
// the moment its plugin registers and not one moment before.
// ---------------------------------------------------------------------------

const PRESENCE_LABEL: Record<PresenceProof, string> = {
  biometric: "Face ID or fingerprint",
  button: "Confirm on device",
  tap: "Tap your card",
  scan: "Scan a QR code",
  "remote-app": "Approve in the wallet app",
};

const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  "device-key": "phone-portrait-outline",
  ledger: "bluetooth-outline",
  trezor: "hardware-chip-outline",
  tangem: "card-outline",
  keystone: "qr-code-outline",
  onekey: "bluetooth-outline",
  walletconnect: "link-outline",
};

function SignerRow({
  signer,
  selected,
  onSelect,
}: {
  signer: AccountSigner;
  selected: boolean;
  onSelect: () => void;
}) {
  const { state, ready, action } = useConnection(signer);
  const caps = signer.capabilities();

  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${signer.label}. ${PRESENCE_LABEL[caps.presence]}.${
        action ? ` ${action}` : ""
      }`}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={styles.icon}>
        <Ionicons
          name={KIND_ICON[signer.kind] ?? "key-outline"}
          size={20}
          color={selected ? colors.neon : colors.textDim}
        />
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.body}>{signer.label}</Text>
        {/* What the user will physically do, not what the transport is called.
            "Confirm on device" is actionable; "BLE" is trivia. */}
        <Text style={type.dim}>{PRESENCE_LABEL[caps.presence]}</Text>
        {action && !ready ? (
          <Text style={[type.dim, { color: colors.warning }]}>{action}</Text>
        ) : null}
      </View>

      {/* A trusted display is the whole reason to prefer hardware, so it is
          stated rather than left for the user to know. */}
      {caps.trustedDisplay ? (
        <View style={styles.badge}>
          <Ionicons name="shield-checkmark-outline" size={12} color={colors.neon} />
          <Text style={[type.dim, { color: colors.neon, fontSize: 11 }]}>Verifies on device</Text>
        </View>
      ) : null}

      {selected ? <Ionicons name="checkmark-circle" size={20} color={colors.neon} /> : null}
      {state.phase === "connecting" || state.phase === "scanning" ? (
        <Ionicons name="ellipsis-horizontal" size={18} color={colors.textDim} />
      ) : null}
    </Pressable>
  );
}

export function SignerPicker({
  selected,
  onSelect,
}: {
  selected: AccountSigner | null;
  onSelect: (signer: AccountSigner) => void;
}) {
  const signers = useAvailableSigners();

  if (signers.length === 0) {
    // Should not happen — the device key is always registered — but an empty
    // list must say so rather than render a blank box.
    return <EmptyState title="No signing method available" />;
  }

  return (
    <View style={{ gap: spacing.sm }} accessibilityRole="radiogroup">
      {signers.map((signer) => (
        <SignerRow
          key={signer.kind}
          signer={signer}
          selected={selected?.kind === signer.kind}
          onSelect={() => onSelect(signer)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowSelected: { borderColor: colors.neon },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: { flexDirection: "row", alignItems: "center", gap: 3 },
});
