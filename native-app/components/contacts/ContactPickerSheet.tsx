import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ContactAvatar } from "@/components/contacts/ContactAvatar";
import { ContactRow } from "@/components/contacts/ContactRow";
import { Button, EmptyState, Field, Sheet } from "@/components/ui";
import { shortAddress } from "@/lib/format";
import { addressesForChain, defaultAddressForChain, type Contact } from "@/lib/contacts/model";
import { useContactsForChain, useServerRecents } from "@/lib/contacts/useContacts";
import { CHAINS, type ChainId } from "@/lib/swap/assets";
import { colors, radius, spacing, type } from "@/lib/theme";

// ---------------------------------------------------------------------------
// Pick a payee from the address book, mid-send.
//
// TWO STAGES, AND THE SECOND ONE IS NOT OPTIONAL. A contact can hold several
// addresses on the same network — an exchange deposit address and a personal
// wallet, say — and silently picking the default would mean the user selected
// "Alice" and paid an address they never looked at. So: one matching address
// resolves immediately; more than one opens the address list first. This is the
// shape Tangem's address book uses (MatchedContact → AddressSelectorBottomSheet)
// and the reasoning is the same in both apps.
//
// THE LIST IS FILTERED TO THE CHAIN BEING PAID. A contact whose only address is
// on another network is not offered at all, because offering it invites exactly
// the mistake the address book exists to prevent — and the "no contacts on this
// network" empty state says which network, so the user can see whether the fix
// is to add an address or to change the source asset.
// ---------------------------------------------------------------------------

export interface ContactPick {
  /** Null for an address paid before but never saved — there is no contact to
   *  name, and inventing one would put a name on the review screen that the
   *  user never chose. */
  contact: Contact | null;
  address: string;
  label?: string;
}

export function ContactPickerSheet({
  open,
  chain,
  onClose,
  onPick,
  onManage,
}: {
  open: boolean;
  /** Undefined before a source asset is chosen — the sheet says so rather than
   *  showing a book filtered to nothing. */
  chain: ChainId | undefined;
  onClose: () => void;
  onPick: (pick: ContactPick) => void;
  /** Opens the full address book (also the empty state's way out). */
  onManage: () => void;
}) {
  const [query, setQuery] = useState("");
  // The contact whose addresses are being chosen between. Cleared on every
  // close so reopening never lands mid-flow in a stage the user did not start.
  const [expanded, setExpanded] = useState<Contact | null>(null);

  const { contacts, isLoading, loaded, error } = useContactsForChain(chain, query);
  const serverRecents = useServerRecents(chain);

  const networkName = chain ? (CHAINS[chain]?.name ?? chain) : null;

  /**
   * Addresses paid on ANOTHER device that are not already saved as contacts.
   *
   * Filtered against the book because a recent that is already a contact is
   * shown above with a name — listing it twice makes the second copy look like
   * a different payee, which on this screen is precisely the wrong impression.
   *
   * Hidden entirely when the deployment keeps no payment history (`durable`
   * false). Rendering "no recent payees" for that case would be asserting
   * something the server explicitly refused to assert.
   */
  const unsavedRecents = useMemo(() => {
    if (!serverRecents.durable) return [];
    const saved = new Set(
      contacts.flatMap((c) => c.addresses.map((a) => a.address.toLowerCase()))
    );
    const q = query.trim().toLowerCase();
    return serverRecents.recents
      .filter((r) => !r.contact && !saved.has(r.address.toLowerCase()))
      .filter((r) => !q || r.address.toLowerCase().includes(q))
      .slice(0, 5);
  }, [serverRecents.durable, serverRecents.recents, contacts, query]);

  const close = () => {
    setExpanded(null);
    setQuery("");
    onClose();
  };

  const choose = (contact: Contact) => {
    if (!chain) return;
    const matching = addressesForChain(contact, chain);
    if (matching.length > 1) {
      setExpanded(contact);
      return;
    }
    // `defaultAddressForChain` rather than matching[0]: they agree when there is
    // exactly one address, and going through the shared helper means the rule
    // for which address is preferred lives in exactly one place.
    const chosen = defaultAddressForChain(contact, chain);
    if (!chosen) return;
    void Haptics.selectionAsync();
    onPick({ contact, address: chosen.address, ...(chosen.label ? { label: chosen.label } : {}) });
    close();
  };

  const expandedAddresses = useMemo(
    () => (expanded && chain ? addressesForChain(expanded, chain) : []),
    [expanded, chain]
  );

  return (
    <Sheet
      open={open}
      title={expanded ? `Pay ${expanded.name}` : "Choose a contact"}
      onClose={close}
    >
      {expanded ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={type.dim}>
            {expanded.name} has {expandedAddresses.length} addresses on {networkName}. Choose which
            one to pay.
          </Text>
          {expandedAddresses.map((entry) => (
            <Pressable
              key={entry.id}
              onPress={() => {
                void Haptics.selectionAsync();
                onPick({
                  contact: expanded,
                  address: entry.address,
                  ...(entry.label ? { label: entry.label } : {}),
                });
                close();
              }}
              style={({ pressed }) => [styles.addressRow, pressed && { borderColor: colors.neon }]}
              accessibilityRole="button"
              accessibilityLabel={`${entry.label ?? "Address"} ${shortAddress(entry.address, 6)}${
                entry.isDefault ? ", preferred" : ""
              }`}
            >
              <ContactAvatar name={expanded.name} color={expanded.avatarColor} size={32} />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.labelRow}>
                  <Text style={styles.addressLabel} numberOfLines={1}>
                    {entry.label ?? "Address"}
                  </Text>
                  {entry.isDefault ? <Text style={styles.defaultTag}>PREFERRED</Text> : null}
                </View>
                <Text style={styles.addressMono} numberOfLines={1}>
                  {shortAddress(entry.address, 8)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </Pressable>
          ))}
          <Button title="Back" variant="secondary" onPress={() => setExpanded(null)} />
        </View>
      ) : !chain ? (
        <EmptyState
          title="Choose what you're paying with first"
          subtitle="The network decides which of your contacts can actually receive this payment."
        />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <Field
            value={query}
            onChangeText={setQuery}
            placeholder="Search name or address"
            autoCapitalize="none"
            autoCorrect={false}
            clearable
            accessibilityLabel="Search contacts"
          />

          {isLoading && !loaded ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.neon} />
            </View>
          ) : error ? (
            /* Never an empty state: "you have no contacts" and "we could not
               load your contacts" look identical to a user and mean opposite
               things — one invites them to add someone, the other should make
               them stop and retry before they pay anyone. */
            <EmptyState
              title="Couldn't load your contacts"
              subtitle="Check your connection and try again. Your saved contacts are unchanged."
            />
          ) : contacts.length === 0 ? (
            <EmptyState
              title={query ? "No matches" : `No contacts on ${networkName}`}
              subtitle={
                query
                  ? "No saved contact matches that name or address."
                  : `None of your contacts has an address that can receive ${networkName} payments yet.`
              }
            />
          ) : (
            contacts.map((contact) => (
              <ContactRow
                key={contact.id}
                contact={contact}
                chain={chain}
                onPress={() => choose(contact)}
                showChevron={false}
              />
            ))
          )}

          {/* Payees from other devices. The local recents row on the recipient
              card covers this phone; these are the ones only the account knows
              about — paid from the web app, or from a phone since replaced. */}
          {unsavedRecents.length ? (
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              <Text style={styles.groupLabel}>PAID BEFORE, NOT SAVED</Text>
              {unsavedRecents.map((r) => (
                <Pressable
                  key={`${r.chain}:${r.address}`}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    // No contact object exists for these, so nothing is passed
                    // as one — the send screen will show them as an ordinary
                    // unnamed address, which is exactly what they are.
                    onPick({ contact: null, address: r.address });
                    close();
                  }}
                  style={({ pressed }) => [styles.recentRow, pressed && { borderColor: colors.neon }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Pay ${shortAddress(r.address, 6)}, paid before on this account`}
                >
                  <Ionicons name="time-outline" size={16} color={colors.textFaint} />
                  <Text style={styles.recentAddress} numberOfLines={1}>
                    {shortAddress(r.address, 8)}
                  </Text>
                  <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
                </Pressable>
              ))}
              <Text style={styles.recentNote}>
                Paid from this account before. Save one as a contact to have FurlPay name it — and
                warn you when a look-alike turns up.
              </Text>
            </View>
          ) : null}

          <Button
            title="Manage address book"
            variant="secondary"
            onPress={() => {
              close();
              onManage();
            }}
            icon={<Ionicons name="people-outline" size={16} color={colors.text} />}
          />
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  centered: { paddingVertical: spacing.xl, alignItems: "center" },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  labelRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  addressLabel: { color: colors.text, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  defaultTag: { color: colors.neon, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  addressMono: { color: colors.textDim, fontSize: 12, fontFamily: "monospace" },
  groupLabel: { color: colors.textFaint, fontSize: 11, fontWeight: "700", letterSpacing: 0.6 },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recentAddress: { color: colors.textDim, fontSize: 13, fontFamily: "monospace", flex: 1 },
  recentNote: { color: colors.textFaint, fontSize: 11, lineHeight: 16 },
});
