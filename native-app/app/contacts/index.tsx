import React, { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ContactRow } from "@/components/contacts/ContactRow";
import { Button, EmptyState, Field, Screen } from "@/components/ui";
import { searchContacts, contactsForChain, type Contact } from "@/lib/contacts/model";
import { useContacts } from "@/lib/contacts/useContacts";
import { timeAgo } from "@/lib/format";
import { useSecureScreen } from "@/lib/secureScreen";
import { CHAINS, type ChainId } from "@/lib/swap/assets";
import { colors, radius, spacing, type } from "@/lib/theme";
import type { Chain } from "@/lib/types";

// ---------------------------------------------------------------------------
// The address book.
//
// WHAT THIS SCREEN IS FOR. Not "a list of people" — a list of addresses the
// user has already checked once, so they never have to check them again. Every
// affordance here is in service of that: the search matches addresses as well
// as names (so a string on the clipboard can be identified before it is paid),
// the network filter answers "who can I pay on this chain", and favourites
// float the handful of payees that account for most sends.
//
// TWO STATES THAT MUST NEVER LOOK ALIKE. An empty book invites the user to add
// someone. A failed load must not — it means we do not know what is in the
// book, and on a payments screen that is the moment to stop, not to start
// typing an address by hand. `loaded` distinguishes them, and the error state
// says the saved contacts are unchanged so a failed fetch does not read as data
// loss.
//
// `?chain=` opens the book pre-filtered, which is how the send screen's
// "Manage address book" link arrives: the user was paying on Base and the book
// should open showing who can receive on Base.
// ---------------------------------------------------------------------------

/** The filter chips. "All" plus the networks the user actually has payees on —
 *  offering all eight chains when the book only holds EVM addresses is eight
 *  taps of noise for one useful one. */
function chainsInBook(contacts: Contact[]): Chain[] {
  const seen = new Set<Chain>();
  for (const contact of contacts) {
    for (const address of contact.addresses) seen.add(address.chain);
  }
  return [...seen].sort();
}

export default function ContactsScreen() {
  // The whole payee book, with full addresses on the detail screen behind it.
  useSecureScreen("contacts");
  const router = useRouter();
  const params = useLocalSearchParams<{ chain?: string }>();
  const { contacts, isLoading, isRefetching, refetch, error, loaded, fromCache, updatedAt } =
    useContacts();

  const [query, setQuery] = useState("");
  const [chain, setChain] = useState<Chain | null>(
    // Only honoured when it is a chain this build knows; a stale deep link must
    // not filter the book down to nothing with no way to tell why.
    params.chain && (CHAINS as Record<string, unknown>)[params.chain]
      ? (params.chain as Chain)
      : null
  );

  const available = useMemo(() => chainsInBook(contacts), [contacts]);

  const visible = useMemo(() => {
    const scoped = chain ? contactsForChain(contacts, chain) : contacts;
    return searchContacts(scoped, query);
  }, [contacts, chain, query]);

  const favourites = visible.filter((c) => c.isFavorite);
  const others = visible.filter((c) => !c.isFavorite);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.neon}
          />
        }
      >
        <Field
          value={query}
          onChangeText={setQuery}
          placeholder="Search name or address"
          autoCapitalize="none"
          autoCorrect={false}
          clearable
          accessibilityLabel="Search contacts"
          right={<Ionicons name="search" size={16} color={colors.textFaint} />}
        />

        {available.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            keyboardShouldPersistTaps="handled"
          >
            <Chip label="All" active={chain === null} onPress={() => setChain(null)} />
            {available.map((c) => (
              <Chip
                key={c}
                label={CHAINS[c as ChainId]?.short ?? c}
                active={chain === c}
                onPress={() => setChain(chain === c ? null : c)}
              />
            ))}
          </ScrollView>
        ) : null}

        {/* Staleness is stated, never implied. A saved copy is genuinely useful
            offline — it is what turns a hex string into a name on the review
            screen — but presenting it as current is how a book that is missing
            the payee you just added becomes a wrong answer. */}
        {fromCache ? (
          <View style={styles.staleBanner} accessibilityRole="alert">
            <Ionicons name="cloud-offline-outline" size={15} color={colors.warning} />
            <Text style={styles.staleText}>
              Saved copy{updatedAt ? `, last synced ${timeAgo(updatedAt)}` : ""}. Anyone added on
              another device since won&rsquo;t appear, and you can&rsquo;t make changes until
              you&rsquo;re back online.
            </Text>
          </View>
        ) : null}

        {isLoading && !loaded ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.neon} />
          </View>
        ) : error ? (
          <View style={{ gap: spacing.md }}>
            <EmptyState
              title="Couldn't load your address book"
              subtitle="Your saved contacts are unchanged — this device just couldn't reach the server."
            />
            <Button title="Try again" variant="secondary" onPress={() => void refetch()} />
          </View>
        ) : contacts.length === 0 ? (
          <View style={{ gap: spacing.md }}>
            <EmptyState
              title="No saved contacts yet"
              subtitle="Save an address once, check it once, and never retype it. A named contact is also what lets FurlPay warn you when an address only looks like one you've used."
            />
            <Button
              title="Add a contact"
              onPress={() => router.push("/contacts/new")}
              icon={<Ionicons name="person-add-outline" size={16} color={colors.onNeon} />}
            />
          </View>
        ) : visible.length === 0 ? (
          <EmptyState
            title="No matches"
            subtitle={
              query
                ? "No saved contact matches that name or address."
                : `None of your contacts has an address on ${CHAINS[chain as ChainId]?.name ?? chain}.`
            }
          />
        ) : (
          <View style={{ gap: spacing.lg }}>
            {favourites.length ? (
              <View style={{ gap: spacing.sm }}>
                <Text style={styles.groupLabel}>FAVOURITES</Text>
                {favourites.map((c) => (
                  <ContactRow
                    key={c.id}
                    contact={c}
                    onPress={() => router.push(`/contacts/${c.id}`)}
                  />
                ))}
              </View>
            ) : null}
            {others.length ? (
              <View style={{ gap: spacing.sm }}>
                {favourites.length ? <Text style={styles.groupLabel}>ALL CONTACTS</Text> : null}
                {others.map((c) => (
                  <ContactRow
                    key={c.id}
                    contact={c}
                    onPress={() => router.push(`/contacts/${c.id}`)}
                  />
                ))}
              </View>
            ) : null}
          </View>
        )}

        {contacts.length > 0 ? (
          <Button
            title="Add a contact"
            variant="secondary"
            onPress={() => router.push("/contacts/new")}
            icon={<Ionicons name="person-add-outline" size={16} color={colors.text} />}
          />
        ) : null}

        <Text style={styles.footnote}>
          Contacts are stored on your FurlPay account, so they follow you to the web app and any
          other device you sign in on.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      title={label}
      variant={active ? "primary" : "secondary"}
      onPress={onPress}
      style={styles.chip}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  chips: { gap: spacing.sm, paddingRight: spacing.md },
  chip: { paddingHorizontal: spacing.md, minWidth: 0, borderRadius: radius.pill },
  centered: { paddingVertical: spacing.xl * 2, alignItems: "center" },
  staleBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  staleText: { color: colors.textDim, fontSize: 12, flex: 1, lineHeight: 17 },
  groupLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  footnote: { ...type.dim, fontSize: 12, color: colors.textFaint, textAlign: "center" },
});
