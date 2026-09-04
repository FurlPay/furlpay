import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { AddressEntryForm, type AddressDraft } from "@/components/contacts/AddressEntryForm";
import { ContactAvatar } from "@/components/contacts/ContactAvatar";
import { Button, ErrorNote, Field, Screen } from "@/components/ui";
import { useIsOffline, OFFLINE_MUTATION_MESSAGE } from "@/lib/net";
import {
  AVATAR_COLORS,
  MAX_NAME_LENGTH,
  nameError,
  suggestAvatarColor,
  type AvatarColor,
} from "@/lib/contacts/model";
import { contactErrorMessage, useContactMutations, useContacts } from "@/lib/contacts/useContacts";
import { colors, radius, spacing, type } from "@/lib/theme";

// ---------------------------------------------------------------------------
// Create a contact.
//
// THE ADDRESS IS OPTIONAL HERE AND THAT IS DELIBERATE. The server allows a
// contact with no addresses, and forcing one at creation is what makes people
// paste a half-remembered string to get past the form. A named contact with no
// address is honest and can be completed later; a named contact with the WRONG
// address is the failure this whole feature exists to prevent.
//
// `?address=` pre-fills the form. That is how "save this payee" from the send
// screen and the scanner arrive — the address has already been through
// `parseScannedAddress` at that point, and AddressEntryForm re-derives the
// network from it rather than trusting a chain in the query string.
// ---------------------------------------------------------------------------

export default function NewContact() {
  const router = useRouter();
  const params = useLocalSearchParams<{ address?: string }>();
  const { contacts } = useContacts();
  const { create } = useContactMutations();
  const offline = useIsOffline();

  const [name, setName] = useState("");
  const [color, setColor] = useState<AvatarColor>(() => suggestAvatarColor(contacts));
  const [address, setAddress] = useState<AddressDraft | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Errors are shown only after the first save attempt. Marking an empty name
  // field red before the user has typed anything is scolding them for not
  // having finished.
  const [attempted, setAttempted] = useState(false);

  const seeded = useMemo(
    () =>
      params.address
        ? ({ address: params.address, chain: "base" } as AddressDraft)
        : null,
    [params.address]
  );

  const nameProblem = nameError(name, contacts);
  const canSave = !nameProblem && !create.isPending && !offline;

  const save = async () => {
    setAttempted(true);
    setSubmitError(null);
    if (nameProblem) return;
    if (offline) {
      // Deliberately NOT queued to the outbox. A queued contact would show in
      // the book as saved while the server has never seen it — and the next
      // send would offer an address that exists only on this device. Failing
      // loudly is the honest outcome (see lib/net.ts).
      setSubmitError(OFFLINE_MUTATION_MESSAGE);
      return;
    }
    try {
      const contact = await create.mutateAsync({
        name: name.trim(),
        avatarColor: color,
        ...(address ? { addresses: [address] } : {}),
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // replace, not push: backing out of a contact that now exists should
      // land on the book, not on the empty form that created it.
      router.replace(`/contacts/${contact.id}`);
    } catch (e) {
      setSubmitError(contactErrorMessage(e));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.preview}>
          <ContactAvatar name={name || "?"} color={color} size={64} />
          <Text style={type.dim}>
            {name.trim() ? name.trim() : "This is how they'll appear when you pay them."}
          </Text>
        </View>

        <Field
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Alice, Binance, Landlord…"
          maxLength={MAX_NAME_LENGTH}
          autoFocus={!params.address}
          accessibilityLabel="Contact name"
        />
        {attempted && nameProblem ? <ErrorNote message={nameProblem} /> : null}

        <View style={{ gap: spacing.sm }}>
          <Text style={styles.label}>COLOUR</Text>
          <View style={styles.swatches}>
            {AVATAR_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setColor(c);
                }}
                style={[
                  styles.swatch,
                  { backgroundColor: c },
                  color === c && styles.swatchActive,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: color === c }}
                accessibilityLabel={`Avatar colour ${c}`}
              />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>FIRST ADDRESS (OPTIONAL)</Text>
          <AddressEntryForm
            value={seeded}
            onChange={setAddress}
            onScan={() => router.push("/scan")}
          />
        </View>

        <ErrorNote message={submitError} />

        <Button
          title="Save contact"
          onPress={() => void save()}
          disabled={!canSave}
          loading={create.isPending}
        />
        {offline ? (
          <View style={styles.notice} accessibilityRole="alert">
            <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
            <Text style={[type.dim, { flex: 1 }]}>{OFFLINE_MUTATION_MESSAGE}</Text>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  preview: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  label: { color: colors.textFaint, fontSize: 11, fontWeight: "700", letterSpacing: 0.6 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: "transparent" },
  swatchActive: { borderColor: colors.text },
  section: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
