// One search control: type it, say it, or pick something you searched before.
//
// ---------------------------------------------------------------------------
// THE ZERO STATE IS THE POINT
//
// An empty search box that shows nothing wastes the most common moment in
// search: the user has tapped the field and has not yet decided what to type.
// Recent searches fill exactly that gap, and in an app people open repeatedly
// to check the same handful of symbols they are usually the answer.
//
// They appear ONLY while the field is focused and empty. A history list that
// covers the results is worse than no history, and one that lingers after
// typing starts is in the way.
//
// A SEARCH IS ONLY REMEMBERED WHEN IT LOOKS DELIBERATE — on submit, on picking
// a recent, or on blur with something typed. Recording every keystroke would
// fill the list with "A", "AA", "AAP" on the way to "AAPL".
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Field } from "@/components/ui";
import { VoiceSearchButton, VoiceStatus } from "@/components/VoiceSearchButton";
import {
  clearRecentSearches,
  forgetSearch,
  listRecentSearches,
  rememberSearch,
} from "@/lib/search/recents";

interface Props {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  /** Keeps histories apart — "markets" and "transactions" are different searches. */
  namespace: string;
  /** Suggested terms shown when there is no history yet. */
  suggestions?: string[];
  autoFocus?: boolean;
}

export function SearchBar({
  value,
  onChangeText,
  placeholder = "Search…",
  namespace,
  suggestions = [],
  autoFocus,
}: Props) {
  const [focused, setFocused] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);

  useEffect(() => {
    setRecents(listRecentSearches(namespace));
  }, [namespace]);

  const commit = useCallback(
    (term: string) => {
      const t = term.trim();
      if (!t) return;
      setRecents(rememberSearch(namespace, t));
    },
    [namespace]
  );

  const pick = useCallback(
    (term: string) => {
      onChangeText(term);
      commit(term);
      setFocused(false);
    },
    [onChangeText, commit]
  );

  /* Shown only in the zero state — focused with an empty field. */
  const showPanel = focused && value.trim().length === 0;
  const hasHistory = recents.length > 0;
  const chips = hasHistory ? recents : suggestions;

  return (
    <View>
      <Field
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        returnKeyType="search"
        clearable
        onFocus={() => setFocused(true)}
        /* Committed on blur as well as submit: on mobile people tap a result
           or dismiss the keyboard far more often than they press Search. */
        onBlur={() => {
          setFocused(false);
          commit(value);
        }}
        onSubmitEditing={() => commit(value)}
        right={
          <VoiceSearchButton
            onPartial={onChangeText}
            onTranscript={(t) => {
              onChangeText(t);
              commit(t);
            }}
            onStatus={setVoiceNote}
          />
        }
      />

      <VoiceStatus message={voiceNote} />

      {showPanel && chips.length > 0 ? (
        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>{hasHistory ? "Recent" : "Try"}</Text>
            {hasHistory ? (
              <Pressable
                onPress={() => {
                  clearRecentSearches(namespace);
                  setRecents([]);
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear recent searches"
              >
                <Text style={styles.clearAll}>Clear</Text>
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.chipRow}
          >
            {chips.map((term) => (
              <View key={term} style={styles.chip}>
                <Pressable
                  onPress={() => pick(term)}
                  accessibilityRole="button"
                  accessibilityLabel={`Search ${term}`}
                  hitSlop={6}
                >
                  <Text style={styles.chipText} numberOfLines={1}>
                    {term}
                  </Text>
                </Pressable>
                {hasHistory ? (
                  <Pressable
                    onPress={() => setRecents(forgetSearch(namespace, term))}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${term} from recent searches`}
                  >
                    <Ionicons name="close" size={13} color={colors.textFaint} />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { paddingTop: spacing.sm, gap: 6 },
  panelHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  panelTitle: {
    ...type.dim,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  clearAll: { color: colors.textFaint, fontSize: 12 },
  chipRow: { gap: spacing.sm, paddingRight: spacing.md },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 7,
    maxWidth: 190,
  },
  chipText: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
});
