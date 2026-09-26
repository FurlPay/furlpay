import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { Button, Field, Screen, ErrorNote } from "@/components/ui";
import { useSecureScreen } from "@/lib/secureScreen";
import { useI18n } from "@/lib/i18n";
import { authenticateDeviceOwner } from "@/lib/biometrics";
import { getAntiPhishingPhrase, setAntiPhishingPhrase } from "@/lib/security/antiPhishing";
import { colors, spacing, type } from "@/lib/theme";

export default function AntiPhishingScreen() {
  useSecureScreen("anti-phishing");
  const router = useRouter();
  const { t: tr } = useI18n();

  const [currentPhrase, setCurrentPhrase] = useState<string | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  
  const [newPhrase, setNewPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadPhrase();
  }, []);

  const loadPhrase = async () => {
    try {
      const phrase = await getAntiPhishingPhrase();
      setCurrentPhrase(phrase);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReveal = async () => {
    const gate = await authenticateDeviceOwner("Confirm it's you to reveal the phrase");
    if (gate.ok) {
      setIsRevealed(true);
    }
  };

  const handleSave = async () => {
    setError(null);
    const cleanPhrase = newPhrase.trim();

    if (cleanPhrase.length < 3 || cleanPhrase.length > 32) {
      setError("Phrase must be between 3 and 32 characters.");
      return;
    }
    if (!/^[a-zA-Z0-9 ]+$/.test(cleanPhrase)) {
      setError("Phrase can only contain letters, numbers, and spaces.");
      return;
    }

    setIsSaving(true);
    try {
      const gate = await authenticateDeviceOwner("Confirm it's you to change the phrase");
      if (!gate.ok) {
        setError("Authentication required to save.");
        setIsSaving(false);
        return;
      }

      await setAntiPhishingPhrase(cleanPhrase);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCurrentPhrase(cleanPhrase);
      setNewPhrase("");
      setIsRevealed(true);
    } catch (e: any) {
      setError(e.message || "Failed to save phrase.");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <Screen><View style={styles.centered} /></Screen>;
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.panel}>
          <Text style={styles.title}>Anti-Phishing Phrase</Text>
          <Text style={type.dim}>
            This phrase appears on every official FurlPay email. If you don't see it, the email is fake.
          </Text>

          {currentPhrase ? (
            <View style={styles.currentPhraseContainer}>
              <Text style={styles.label}>Current Phrase</Text>
              {isRevealed ? (
                <Text style={styles.phraseText}>{currentPhrase}</Text>
              ) : (
                <Button 
                  title="Reveal Phrase" 
                  variant="secondary" 
                  onPress={handleReveal} 
                />
              )}
            </View>
          ) : null}
        </View>

        <View style={styles.panel}>
          <Text style={styles.label}>
            {currentPhrase ? "Set New Phrase" : "Set Phrase"}
          </Text>
          <Field
            value={newPhrase}
            onChangeText={setNewPhrase}
            placeholder="e.g. Blue Elephant 42"
            maxLength={32}
            accessibilityLabel="Anti-phishing phrase input"
          />
          <Text style={styles.note}>
            3-32 characters, letters and numbers only.
          </Text>
          <ErrorNote message={error} />
          
          <Button
            title="Save Phrase"
            onPress={handleSave}
            loading={isSaving}
            disabled={isSaving || newPhrase.trim().length < 3}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    padding: spacing.md,
    gap: spacing.lg,
  },
  panel: {
    gap: spacing.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 16,
  },
  title: {
    ...type.h2,
    color: colors.text,
  },
  label: {
    ...type.body,
    fontWeight: "600",
    color: colors.text,
  },
  currentPhraseContainer: {
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  phraseText: {
    ...type.h2,
    color: colors.neon,
    textAlign: "center",
    paddingVertical: spacing.sm,
  },
  note: {
    ...type.dim,
    fontSize: 13,
  },
});
