import React, { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { AddressEntryForm, type AddressDraft } from "@/components/contacts/AddressEntryForm";
import { ContactAvatar } from "@/components/contacts/ContactAvatar";
import { Button, EmptyState, ErrorNote, Screen, Sheet } from "@/components/ui";
import { grouped } from "@/components/send/RecipientInput";
import { OFFLINE_MUTATION_MESSAGE, useIsOffline } from "@/lib/net";
import { useSecureScreen } from "@/lib/secureScreen";
import {
  MAX_ADDRESSES_PER_CONTACT,
  chainKind,
  duplicateAddressError,
  type ContactAddress,
} from "@/lib/contacts/model";
import { contactErrorMessage, useContact, useContactMutations } from "@/lib/contacts/useContacts";
import { CHAINS, type ChainId } from "@/lib/swap/assets";
import { colors, radius, spacing, type } from "@/lib/theme";

// ---------------------------------------------------------------------------
// One contact: their addresses, and everything you can do to them.
//
// ADDRESSES ARE SHOWN IN FULL, GROUPED IN FOURS. This is the screen where a
// user comes to check that a saved address is still the right one, and a
// truncated `0x1a2b…9f3c` is unverifiable — worse, it is the exact form address
// poisoning is designed to survive. `grouped()` is the same helper the send
// screen's verification block uses, so the two renderings a user compares are
// character-for-character identical.
//
// REMOVING AN ADDRESS IS CONFIRMED; REMOVING THE CONTACT IS CONFIRMED HARDER.
// Neither is recoverable, and a contact is often the only place a long-lived
// deposit address is written down.
//
// "PREFERRED" IS PER CHAIN FAMILY, NOT PER CONTACT — the server's rule, and the
// UI has to state it or the user will read a single ticked row as global.
// ---------------------------------------------------------------------------

export default function ContactDetail() {
  // Full, unabbreviated addresses for every payee this person has.
  useSecureScreen("contact-detail");
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: contact, isLoading, error } = useContact(id);
  const mutations = useContactMutations();
  const offline = useIsOffline();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<AddressDraft | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>) => {
    setActionError(null);
    if (offline) {
      setActionError(OFFLINE_MUTATION_MESSAGE);
      return false;
    }
    try {
      await work();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return true;
    } catch (e) {
      setActionError(contactErrorMessage(e));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return false;
    }
  };

  if (isLoading && !contact) {
    return (
      <Screen>
        <View style={styles.centered}>
          <Text style={type.dim}>Loading…</Text>
        </View>
      </Screen>
    );
  }

  if (!contact) {
    return (
      <Screen>
        <View style={styles.centered}>
          <EmptyState
            title={error ? "Couldn't load this contact" : "Contact not found"}
            subtitle={
              error
                ? "Check your connection and try again. Nothing has been changed."
                : "It may have been deleted on another device."
            }
          />
          <Button title="Back to address book" variant="secondary" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  const atAddressLimit = contact.addresses.length >= MAX_ADDRESSES_PER_CONTACT;
  const duplicate = draft ? duplicateAddressError(contact, draft.address, draft.chain) : null;

  const removeAddress = (entry: ContactAddress) => {
    Alert.alert(
      "Remove this address?",
      `${entry.address}\n\nIt will no longer be offered when you pay ${contact.name}. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void run(() =>
              mutations.removeAddress.mutateAsync({ id: contact.id, addressId: entry.id })
            );
          },
        },
      ]
    );
  };

  const removeContact = () => {
    Alert.alert(
      `Delete ${contact.name}?`,
      contact.addresses.length
        ? `${contact.addresses.length} saved ${
            contact.addresses.length === 1 ? "address" : "addresses"
          } will be deleted with them. This cannot be undone.`
        : "This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void run(() => mutations.remove.mutateAsync(contact.id)).then((ok) => {
              if (ok) router.replace("/contacts");
            });
          },
        },
      ]
    );
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <ContactAvatar name={contact.name} color={contact.avatarColor} size={72} />
          <Text style={type.title}>{contact.name}</Text>
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              void run(() =>
                mutations.update.mutateAsync({
                  id: contact.id,
                  patch: { isFavorite: !contact.isFavorite },
                })
              );
            }}
            disabled={mutations.busy}
            style={({ pressed }) => [styles.favourite, pressed && { borderColor: colors.neon }]}
            accessibilityRole="button"
            accessibilityState={{ selected: contact.isFavorite }}
            accessibilityLabel={
              contact.isFavorite ? "Remove from favourites" : "Add to favourites"
            }
          >
            <Ionicons
              name={contact.isFavorite ? "star" : "star-outline"}
              size={15}
              color={contact.isFavorite ? colors.warning : colors.textDim}
            />
            <Text style={styles.favouriteText}>
              {contact.isFavorite ? "Favourite" : "Add to favourites"}
            </Text>
          </Pressable>
        </View>

        <ErrorNote message={actionError} />

        <View style={{ gap: spacing.sm }}>
          <Text style={styles.label}>
            ADDRESSES{contact.addresses.length ? ` (${contact.addresses.length})` : ""}
          </Text>

          {contact.addresses.length === 0 ? (
            <EmptyState
              title="No addresses yet"
              subtitle={`Add one and ${contact.name} becomes payable in a tap, with no address to retype.`}
            />
          ) : (
            contact.addresses.map((entry) => {
              const meta = CHAINS[entry.chain as ChainId];
              return (
                <View key={entry.id} style={styles.card}>
                  <View style={styles.cardHead}>
                    <View style={[styles.dot, { backgroundColor: meta?.color ?? colors.textFaint }]} />
                    <Text style={styles.network}>{meta?.name ?? entry.chain}</Text>
                    {entry.isDefault ? (
                      <Text style={styles.defaultTag}>
                        PREFERRED · {chainKind(entry.chain).toUpperCase()}
                      </Text>
                    ) : null}
                  </View>

                  {entry.label ? <Text style={styles.entryLabel}>{entry.label}</Text> : null}

                  {/* In full, grouped in fours, uniform colour — the same
                      treatment as the send screen's verification block. Nothing
                      is emphasised, because emphasising the ends is what makes
                      a poisoned look-alike pass a human check. */}
                  <Text style={styles.address} selectable allowFontScaling={false}>
                    {grouped(entry.address)}
                  </Text>

                  <View style={styles.cardActions}>
                    <MiniAction
                      icon="copy-outline"
                      label="Copy"
                      onPress={() => {
                        void Clipboard.setStringAsync(entry.address);
                        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      }}
                    />
                    <MiniAction
                      icon="send-outline"
                      label="Pay"
                      onPress={() =>
                        router.push({ pathname: "/(tabs)/send", params: { to: entry.address } })
                      }
                    />
                    {!entry.isDefault ? (
                      <MiniAction
                        icon="star-outline"
                        label="Prefer"
                        onPress={() => {
                          void run(() =>
                            mutations.setDefaultAddress.mutateAsync({
                              id: contact.id,
                              addressId: entry.id,
                            })
                          );
                        }}
                      />
                    ) : null}
                    <MiniAction
                      icon="trash-outline"
                      label="Remove"
                      destructive
                      onPress={() => removeAddress(entry)}
                    />
                  </View>
                </View>
              );
            })
          )}

          <Button
            title={atAddressLimit ? "Address limit reached" : "Add an address"}
            variant="secondary"
            disabled={atAddressLimit || mutations.busy}
            onPress={() => {
              setDraft(null);
              setAdding(true);
            }}
            icon={<Ionicons name="add" size={16} color={colors.text} />}
          />
        </View>

        <Button title={`Delete ${contact.name}`} variant="danger" onPress={removeContact} />
      </ScrollView>

      <Sheet open={adding} title="Add an address" onClose={() => setAdding(false)}>
        <AddressEntryForm
          value={null}
          onChange={setDraft}
          usedChains={contact.addresses.map((a) => a.chain)}
          onScan={() => {
            setAdding(false);
            router.push("/scan");
          }}
          autoFocus
        />
        {duplicate ? <ErrorNote message={duplicate} /> : null}
        <Button
          title="Add address"
          disabled={!draft || !!duplicate || mutations.addAddress.isPending}
          loading={mutations.addAddress.isPending}
          onPress={() => {
            if (!draft) return;
            void run(() =>
              mutations.addAddress.mutateAsync({ id: contact.id, input: draft })
            ).then((ok) => {
              if (ok) {
                setAdding(false);
                setDraft(null);
              }
            });
          }}
        />
      </Sheet>
    </Screen>
  );
}

function MiniAction({
  icon,
  label,
  onPress,
  destructive = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const tint = destructive ? colors.accent : colors.textDim;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.mini, pressed && { borderColor: tint }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={14} color={tint} />
      <Text style={[styles.miniText, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  centered: { flex: 1, justifyContent: "center", padding: spacing.md, gap: spacing.md },
  header: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  favourite: {
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
  favouriteText: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  label: { color: colors.textFaint, fontSize: 11, fontWeight: "700", letterSpacing: 0.6 },
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  network: { color: colors.text, fontSize: 14, fontWeight: "700", flex: 1 },
  defaultTag: { color: colors.neon, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  entryLabel: { color: colors.textDim, fontSize: 12 },
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
  cardActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  mini: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  miniText: { fontSize: 11, fontWeight: "700" },
});
