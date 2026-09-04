import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Field } from "@/components/ui";
import { parseScannedAddress } from "@/lib/qr";
import { chainsForAddress, MAX_LABEL_LENGTH } from "@/lib/contacts/model";
import { label as memoLabel, memoError, memoSpec, serializeMemo, supportsMemo } from "@/lib/contacts/memo";
import { CHAINS, type ChainId } from "@/lib/swap/assets";
import { colors, radius, spacing, type } from "@/lib/theme";
import type { Chain } from "@/lib/types";

// ---------------------------------------------------------------------------
// Enter one address: the string, the network it is on, and an optional label.
//
// THE NETWORK LIST IS DERIVED FROM THE ADDRESS, NOT ASKED FOR BLIND. Tangem's
// address book does this and it removes a whole class of unpayable contact: the
// address itself already says which family it belongs to, so presenting all
// eight networks and hoping the user picks a compatible one is presenting seven
// wrong answers. Here the chips appear only once the address parses, and only
// for chains that can actually receive it.
//
// IT STILL ASKS, THOUGH. One EVM address is valid on seven networks and only
// the user knows which one they mean — deriving the family is knowledge, and
// guessing the network would be fabrication. A Solana address has exactly one
// answer, so that one is pre-selected and the row explains itself rather than
// presenting a choice of one.
//
// WHAT IS PASTED IS PARSED, NOT TRUSTED. The clipboard goes through
// `parseScannedAddress` — the same parser the QR scanner and the send screen
// use — so a copied payment link resolves to its payee, and an EIP-681
// contract-call URI resolves to the payee rather than to the token contract.
// Saving that contract as a contact would be saving a permanent trap.
// ---------------------------------------------------------------------------

export interface AddressDraft {
  address: string;
  chain: Chain;
  label?: string;
  /**
   * Memo or destination tag, on the chains that route by one.
   *
   * Absent for every chain FurlPay supports today — all eight are EVM or Solana
   * and the address is the whole destination — so no memo field is rendered and
   * this is never set. It is part of the shape now so that adding a chain which
   * DOES need one (XRP, Stellar, Cosmos) is a new branch rather than a schema
   * migration over already-stored addresses. See lib/contacts/memo.ts.
   */
  memo?: string;
}

export function AddressEntryForm({
  value,
  onChange,
  /** Chains already used by this contact — shown as taken so the user is not
   *  invited to create a duplicate the server would then reject with a 409. */
  usedChains = [],
  onScan,
  autoFocus = false,
}: {
  value: AddressDraft | null;
  onChange: (draft: AddressDraft | null) => void;
  usedChains?: readonly Chain[];
  onScan?: () => void;
  autoFocus?: boolean;
}) {
  const [address, setAddress] = useState(value?.address ?? "");
  const [chain, setChain] = useState<Chain | null>(value?.chain ?? null);
  const [label, setLabel] = useState(value?.label ?? "");
  const [memo, setMemo] = useState(value?.memo ?? "");
  const [notice, setNotice] = useState<string | null>(null);

  const candidates = useMemo(() => chainsForAddress(address), [address]);
  const parsed = candidates.length > 0;

  // Keep the selection honest as the address changes: a chain chosen for an EVM
  // address must not survive the user replacing it with a Solana one, or the
  // form would submit a pairing the server rejects as invalid_address.
  useEffect(() => {
    if (!parsed) {
      if (chain !== null) setChain(null);
      return;
    }
    if (chain && candidates.includes(chain)) return;
    // Exactly one possibility is not a choice — select it.
    setChain(candidates.length === 1 ? candidates[0] : null);
  }, [candidates, parsed, chain]);

  // Publish upward only when the draft is complete. A half-filled form is not a
  // value the caller can save, and emitting one would let a screen enable its
  // save button before there is anything to save.
  useEffect(() => {
    const trimmed = address.trim();
    if (!trimmed || !chain) {
      onChange(null);
      return;
    }
    // A chain whose memo is REQUIRED must not publish a draft without one: an
    // address saved without its tag is a deposit that arrives and is never
    // credited, and the caller's save button reads this value to decide whether
    // it may be pressed.
    if (memoError(chain, memo)) {
      onChange(null);
      return;
    }
    onChange({
      address: trimmed,
      chain,
      ...(label.trim() ? { label: label.trim().slice(0, MAX_LABEL_LENGTH) } : {}),
      ...serializeMemo(chain, memo),
    });
    // `onChange` is intentionally excluded: callers pass an inline closure, and
    // depending on it would re-publish on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, chain, label, memo]);

  const paste = async () => {
    setNotice(null);
    let raw = "";
    try {
      raw = (await Clipboard.getStringAsync()) ?? "";
    } catch {
      setNotice("Couldn't read the clipboard.");
      return;
    }
    if (!raw.trim()) {
      setNotice("Your clipboard is empty.");
      return;
    }
    const found = parseScannedAddress(raw);
    if (!found) {
      setNotice("That clipboard text isn't a payable address.");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAddress(found);
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Field
        label="Address"
        value={address}
        onChangeText={(v) => {
          setNotice(null);
          setAddress(v);
        }}
        placeholder="0x… or a Solana address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        style={styles.mono}
        accessibilityLabel="Contact address"
        right={
          <View style={styles.fieldActions}>
            <IconAction icon="clipboard-outline" label="Paste address" onPress={() => void paste()} />
            {onScan ? <IconAction icon="qr-code-outline" label="Scan a QR code" onPress={onScan} /> : null}
          </View>
        }
      />

      {notice ? (
        <View style={styles.statusRow} accessibilityRole="alert">
          <Ionicons name="alert-circle-outline" size={14} color={colors.warning} />
          <Text style={[styles.statusText, { color: colors.warning }]}>{notice}</Text>
        </View>
      ) : address.trim() && !parsed ? (
        <View style={styles.statusRow} accessibilityLiveRegion="polite">
          <Ionicons name="close-circle-outline" size={14} color={colors.accent} />
          <Text style={[styles.statusText, { color: colors.accent }]}>
            That isn&rsquo;t a valid EVM or Solana address, so it can&rsquo;t be saved.
          </Text>
        </View>
      ) : null}

      {parsed ? (
        candidates.length === 1 ? (
          <View style={styles.statusRow}>
            <Ionicons name="checkmark-circle" size={14} color={colors.neon} />
            <Text style={[styles.statusText, { color: colors.neon }]}>
              {CHAINS[candidates[0] as ChainId]?.name ?? candidates[0]} address.
            </Text>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Text style={styles.prompt}>
              This address is valid on {candidates.length} networks. Which one will you pay them on?
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
              keyboardShouldPersistTaps="handled"
            >
              {candidates.map((c) => {
                const taken = usedChains.includes(c);
                const meta = CHAINS[c as ChainId];
                return (
                  <Pressable
                    key={c}
                    onPress={() => {
                      if (taken) return;
                      void Haptics.selectionAsync();
                      setChain(c);
                    }}
                    disabled={taken}
                    style={({ pressed }) => [
                      styles.chip,
                      chain === c && { borderColor: colors.neon, backgroundColor: colors.neonSoft },
                      pressed && { borderColor: colors.neon },
                      taken && { opacity: 0.35 },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: chain === c, disabled: taken }}
                    accessibilityLabel={
                      taken
                        ? `${meta?.name ?? c} — already saved for this contact`
                        : (meta?.name ?? c)
                    }
                  >
                    <View style={[styles.dot, { backgroundColor: meta?.color ?? colors.textFaint }]} />
                    <Text style={[styles.chipText, chain === c && { color: colors.text }]}>
                      {meta?.name ?? c}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )
      ) : null}

      {/* Rendered ONLY on a chain that routes by one. No chain FurlPay supports
          today does, so this is dead on screen and alive in the type system —
          which is the point: the day XRP or Stellar is added, memoSpec forces
          the decision and this field appears without a schema migration. */}
      {parsed && chain && supportsMemo(chain) ? (
        <>
          <Field
            label={
              memoSpec(chain).requirement === "required"
                ? `${cap(memoLabel(memoSpec(chain).kind))} (required)`
                : `${cap(memoLabel(memoSpec(chain).kind))} (optional)`
            }
            value={memo}
            onChangeText={setMemo}
            maxLength={memoSpec(chain).maxLength}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={memoLabel(memoSpec(chain).kind)}
          />
          {memoSpec(chain).hint ? (
            <Text style={styles.statusText}>{memoSpec(chain).hint}</Text>
          ) : null}
          {memoError(chain, memo) ? (
            <View style={styles.statusRow} accessibilityRole="alert">
              <Ionicons name="alert-circle-outline" size={14} color={colors.accent} />
              <Text style={[styles.statusText, { color: colors.accent }]}>
                {memoError(chain, memo)}
              </Text>
            </View>
          ) : null}
        </>
      ) : null}

      {parsed && chain ? (
        <Field
          label="Label (optional)"
          value={label}
          onChangeText={setLabel}
          placeholder="Exchange deposit, cold wallet…"
          maxLength={MAX_LABEL_LENGTH}
          accessibilityLabel="Address label"
        />
      ) : null}
    </View>
  );
}

function IconAction({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={18} color={colors.textDim} />
    </Pressable>
  );
}

/** Sentence-case a field label without a dependency. */
function cap(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

const styles = StyleSheet.create({
  mono: { fontFamily: "monospace", fontSize: 14 },
  fieldActions: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusText: { color: colors.textFaint, fontSize: 12, flex: 1 },
  prompt: { ...type.dim, fontSize: 12 },
  chips: { gap: spacing.sm, paddingRight: spacing.md },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
