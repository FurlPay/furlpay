import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { grouped } from "@/components/send/RecipientInput";
import { CHAINS, type ChainId } from "@/lib/swap/assets";
import { colors, radius, spacing } from "@/lib/theme";
import type { NameResolutionState } from "@/lib/contacts/useResolveName";

// ---------------------------------------------------------------------------
// What a typed name resolved to.
//
// SIX STATES, AND THE POINT IS THAT THEY DO NOT COLLAPSE INTO THREE.
//
//   resolving    — asking
//   resolved     — here is the address; you decide whether to use it
//   unresolved   — the resolver answered: there is no such name
//   unavailable  — the lookup FAILED; we do not know whether it exists
//   offline      — this device has no connection; also not an answer
//   invalid      — that string could never be a name
//
// The two in the middle are the reason this component is not three lines. A
// user told "no such name" when in fact an RPC timed out will retype a name
// that was correct, then give up and paste an address from somewhere less
// trustworthy. The server distinguishes 404 from 503 on purpose; throwing that
// away in the last 40 pixels of the journey would waste the whole design.
//
// THE ADDRESS IS SHOWN IN FULL AND APPLIED ONLY ON A TAP. A resolver quietly
// replacing the contents of the "To" field is a silent change of payee, which
// is the exact shape of the attack the rest of this screen is built against.
// The same `grouped()` helper renders it as the verification block does, so the
// string the user checks here is character-for-character the one they will
// check after accepting it.
// ---------------------------------------------------------------------------

export function NameResolution({
  state,
  chain,
  onUse,
}: {
  state: NameResolutionState;
  /** The chain being paid, when one is chosen. */
  chain?: ChainId;
  onUse: (address: string) => void;
}) {
  if (state.kind === "idle") return null;

  if (state.kind === "resolving") {
    return (
      <View style={styles.card} accessibilityLiveRegion="polite">
        <ActivityIndicator size="small" color={colors.textDim} />
        <Text style={styles.dim} numberOfLines={1}>
          Looking up {state.name}…
        </Text>
      </View>
    );
  }

  if (state.kind === "invalid") {
    return (
      <Note tone="neutral" icon="help-circle-outline" text={state.message} />
    );
  }

  if (state.kind === "unresolved") {
    return (
      <Note
        tone="neutral"
        icon="search-outline"
        text={`No wallet is registered to ${state.name}. Check the spelling, or paste an address instead.`}
      />
    );
  }

  if (state.kind === "offline") {
    return (
      <Note
        tone="warn"
        icon="cloud-offline-outline"
        // Careful wording: this does NOT say the name is wrong. It says we did
        // not ask.
        text={`You're offline, so ${state.name} couldn't be looked up. It may still be valid — reconnect, or paste the address directly.`}
      />
    );
  }

  if (state.kind === "unavailable") {
    return (
      <Note
        tone="warn"
        icon="alert-circle-outline"
        // Likewise. "We could not check" is the honest claim; "does not exist"
        // is a claim the server explicitly refused to make.
        text={`${state.message} That doesn't mean ${state.name} is wrong — we just couldn't reach the name service. Try again, or paste the address.`}
      />
    );
  }

  // ── resolved ─────────────────────────────────────────────────────────────
  const chainName = chain ? (CHAINS[chain]?.name ?? chain) : null;

  if (!state.payableOnChain) {
    return (
      <Note
        tone="bad"
        icon="close-circle-outline"
        text={`${state.display} resolves to an address that can't receive ${
          chainName ?? "this network's"
        } payments. Switch what you're paying with, or use a different recipient.`}
      />
    );
  }

  return (
    <View style={styles.resolved} accessibilityLiveRegion="polite">
      <View style={styles.resolvedHead}>
        <Ionicons name="checkmark-circle" size={15} color={colors.neon} />
        <Text style={styles.resolvedName} numberOfLines={1}>
          {state.display}
        </Text>
        {/* A name the user saved themselves outranks any resolver, so when the
            answer is also in their address book, say whose it is. */}
        {state.contactName ? (
          <View style={styles.contactTag}>
            <Ionicons name="person" size={10} color={colors.neon} />
            <Text style={styles.contactTagText} numberOfLines={1}>
              {state.contactName}
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.address} selectable allowFontScaling={false}>
        {grouped(state.address)}
      </Text>

      <Text style={styles.caution}>
        Names are resolved by the network, not by FurlPay. Check the address before you send.
      </Text>

      <Pressable
        onPress={() => {
          void Haptics.selectionAsync();
          onUse(state.address);
        }}
        style={({ pressed }) => [styles.useButton, pressed && { borderColor: colors.neon }]}
        accessibilityRole="button"
        accessibilityLabel={`Use the address ${state.display} resolves to`}
      >
        <Ionicons name="arrow-down-circle-outline" size={15} color={colors.neon} />
        <Text style={styles.useText}>Use this address</Text>
      </Pressable>
    </View>
  );
}

function Note({
  tone,
  icon,
  text,
}: {
  tone: "neutral" | "warn" | "bad";
  icon: React.ComponentProps<typeof Ionicons>["name"];
  text: string;
}) {
  const color =
    tone === "warn" ? colors.warning : tone === "bad" ? colors.accent : colors.textDim;
  return (
    <View style={styles.card} accessibilityRole="alert">
      <Ionicons name={icon} size={15} color={color} />
      <Text style={[styles.dim, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dim: { color: colors.textDim, fontSize: 12, flex: 1, lineHeight: 17 },
  resolved: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resolvedHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  resolvedName: { color: colors.text, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  contactTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.neonSoft,
    maxWidth: 140,
  },
  contactTagText: { color: colors.neon, fontSize: 10, fontWeight: "800" },
  address: {
    color: colors.text,
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 20,
    letterSpacing: 0.5,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  caution: { color: colors.textFaint, fontSize: 11, lineHeight: 16 },
  useButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  useText: { color: colors.neon, fontSize: 13, fontWeight: "700" },
});
