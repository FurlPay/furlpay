import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, ErrorNote, Sheet, SummaryRow, Surface } from "@/components/ui";
import { colors, radius, spacing, type } from "@/lib/theme";
import { useConnection } from "@/lib/signing/useSigner";
import { requireOwnConfirmation, type AccountSigner } from "@/lib/signing/types";

// ---------------------------------------------------------------------------
// The confirmation a user sees before a signer is handed a transaction.
//
// WHY THIS EXISTS AT ALL. `requireOwnConfirmation(signer)` has been in the
// signing layer since the abstraction landed, returning TRUE for the on-device
// key and for Tangem — and nothing implemented it. Both of those sign without
// a trusted display, which means the app's own screen is the only thing between
// a user and a payload they never read. This is that screen.
//
// For a signer WITH a trusted display (Ledger), the device is authoritative and
// this sheet is a courtesy — it says what is about to be sent and then points
// at the hardware, because the bytes the Secure Element renders are the ones
// that matter, not the ones we drew.
//
// The distinction is not cosmetic and it is not a prop: it is read from
// capabilities, so a new signer gets the right treatment by declaring itself
// honestly rather than by a caller remembering.
// ---------------------------------------------------------------------------

export interface SigningRequest {
  /** "Swap 100 USDC for DAI" — what the user thinks they are doing. */
  summary: string;
  /** Field-by-field detail, rendered in order. */
  details: { label: string; value: string }[];
  /** Network name, always shown: a right transaction on a wrong chain is wrong. */
  network: string;
}

export type SigningPhase = "idle" | "confirming" | "signing" | "broadcasting" | "failed";

export function SigningSheet({
  open,
  signer,
  request,
  phase,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  signer: AccountSigner | null;
  request: SigningRequest | null;
  phase: SigningPhase;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { ready, action } = useConnection(signer);

  if (!signer || !request) return null;

  const caps = signer.capabilities();
  const ownConfirmation = requireOwnConfirmation(signer);
  const busy = phase === "signing" || phase === "broadcasting";

  return (
    <Sheet open={open} title="Confirm transaction" onClose={busy ? () => {} : onCancel}>
      <View style={{ gap: spacing.md }}>
        <Surface style={{ gap: 4 }}>
          <Text style={type.body}>{request.summary}</Text>
          <Text style={type.dim}>on {request.network}</Text>
        </Surface>

        <Surface style={{ gap: 2 }}>
          {request.details.map((d) => (
            <SummaryRow key={d.label} k={d.label} v={d.value} />
          ))}
        </Surface>

        {/* Where the truth lives, stated plainly. A user who thinks the phone
            verified something it cannot verify is worse off than one who knows
            they are trusting it. */}
        <View style={styles.trustNote}>
          <Ionicons
            name={caps.trustedDisplay ? "shield-checkmark-outline" : "phone-portrait-outline"}
            size={16}
            color={caps.trustedDisplay ? colors.neon : colors.warning}
          />
          <Text style={[type.dim, { flex: 1 }]}>
            {caps.trustedDisplay
              ? `Check these details on ${signer.label} before approving — its screen is the one that counts.`
              : caps.prehashedOnly
                ? `${signer.label} signs without showing you the transaction. Check these details carefully.`
                : "These details are shown on this phone. Check them before approving."}
          </Text>
        </View>

        {/* Connection trouble is reported where the user is about to act, not
            in a banner they already scrolled past. */}
        {!ready && action ? (
          <View style={styles.blocker}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
            <Text style={[type.dim, { color: colors.warning, flex: 1 }]}>{action}</Text>
          </View>
        ) : null}

        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.neon} />
            <Text style={type.dim}>
              {phase === "signing"
                ? caps.trustedDisplay
                  ? `Confirm on ${signer.label}…`
                  : "Signing…"
                : "Sending to the network…"}
            </Text>
          </View>
        ) : null}

        <ErrorNote message={phase === "failed" ? (error ?? "That didn't go through.") : null} />

        <Button
          title={ownConfirmation ? "Confirm and sign" : `Continue on ${signer.label}`}
          onPress={onConfirm}
          // Blocked until the link is usable: sending a transaction to a locked
          // device produces a timeout the user cannot interpret.
          disabled={!ready || busy}
        />
        {!busy ? <Button title="Cancel" variant="outline" onPress={onCancel} /> : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  trustNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
  },
  blocker: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  busy: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
