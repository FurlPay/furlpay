import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ContactAvatar } from "@/components/contacts/ContactAvatar";
import { shortAddress } from "@/lib/format";
import { CHAINS, type ChainId } from "@/lib/swap/assets";
import { colors, radius, spacing } from "@/lib/theme";
import type { Contact } from "@/lib/contacts/model";

// ---------------------------------------------------------------------------
// One contact, in a list.
//
// THE SUBTITLE IS THE POINT. A row that shows only a name is a row the user has
// to tap to learn anything from, and on a send screen that is a tap taken while
// they still do not know whether this contact can even receive the payment. So
// the second line answers the two questions that actually matter here: how many
// addresses are on file for the network in play, and which one would be used.
//
// The address is shown truncated, in monospace, and NEVER with its first and
// last characters emphasised — that habit is what address poisoning exploits
// (see lib/send/lookalike.ts). It is a reminder of which address this is, not a
// verification surface; verification happens in full, grouped in fours, on the
// recipient card.
// ---------------------------------------------------------------------------

export function ContactRow({
  contact,
  /** The chain in play, when there is one — decides what the subtitle says. */
  chain,
  onPress,
  onLongPress,
  /** Renders a chevron rather than a checkmark slot. Lists use it; pickers
   *  do not, because in a picker the whole row IS the action. */
  showChevron = true,
  selected = false,
}: {
  contact: Contact;
  chain?: ChainId;
  onPress: () => void;
  onLongPress?: () => void;
  showChevron?: boolean;
  selected?: boolean;
}) {
  const relevant = contact.addresses;
  const primary = relevant.find((a) => a.isDefault) ?? relevant[0];
  const extra = relevant.length - 1;

  const subtitle = !primary
    ? // Reachable only when the caller passes an unfiltered book: a contact
      // with no addresses at all is legitimate (it was created before one was
      // added) and must read as an invitation rather than an error.
      "No addresses yet"
    : extra > 0
      ? `${shortAddress(primary.address, 6)} +${extra} more`
      : shortAddress(primary.address, 6);

  const networkLabel = primary ? (CHAINS[primary.chain as ChainId]?.name ?? primary.chain) : null;

  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.row,
        (pressed || selected) && { borderColor: colors.neon },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={
        primary
          ? `${contact.name}${contact.isFavorite ? ", favourite" : ""}. ${
              extra > 0 ? `${relevant.length} addresses` : `1 address`
            }${networkLabel ? ` on ${networkLabel}` : ""}.`
          : `${contact.name}. No addresses saved yet.`
      }
    >
      <ContactAvatar name={contact.name} color={contact.avatarColor} favorite={contact.isFavorite} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {contact.name}
        </Text>
        <View style={styles.subRow}>
          <Text style={styles.address} numberOfLines={1}>
            {subtitle}
          </Text>
          {/* Only when a chain is NOT already fixed by the caller. Inside a
              chain-filtered picker every row is on that network, so repeating
              it on each one is noise the user has to read past. */}
          {!chain && networkLabel ? <Text style={styles.network}>{networkLabel}</Text> : null}
        </View>
      </View>
      {showChevron ? (
        <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  body: { flex: 1, gap: 3 },
  name: { color: colors.text, fontSize: 15, fontWeight: "700" },
  subRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  address: { color: colors.textDim, fontSize: 12, fontFamily: "monospace", flexShrink: 1 },
  network: { color: colors.textFaint, fontSize: 11, fontWeight: "600" },
});
