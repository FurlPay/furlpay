import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button, ErrorNote, Screen, SectionHeader, Surface } from "@/components/ui";
import { PassportSteps } from "@/components/PassportSteps";
import { CountryPicker, type Country } from "@/components/CountryPicker";
import { initDocumentScan, runDocumentFlow } from "@/lib/passport";
import { ApiError } from "@/lib/api";
import { useSecureScreen } from "@/lib/secureScreen";
import { colors, radius, spacing, type } from "@/lib/theme";

// Document-scanning flow — a 4-step wizard.
//
// 1. Country — open CountryPicker in a Sheet
// 2. Document type — if the country offers multiple doc types, show pills
// 3. Verify — launch the hosted flow in the system browser
// 4. Done — success confirmation
//
// This screen never touches a camera. The provider's hosted flow captures the
// document and selfie in the system browser. See lib/passport.ts for why.

export default function PassportScanScreen() {
  // The wallet screen is FLAG_SECURE; the flow that FEEDS it must be too.
  // This screen shows the issuing country, document type and verification
  // state, and — critically — it is the screen Android snapshots for the
  // recents thumbnail while the user is away in the hosted browser flow.
  // Protecting the result but not the process leaves the gap open in the one
  // place the user is guaranteed to leave the app.
  useSecureScreen("passport-scan");

  const router = useRouter();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(true); // Open immediately on mount
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const handleCountrySelect = useCallback((country: Country) => {
    setSelectedCountry(country);
    setPickerOpen(false);
    setError(null);

    if (country.documentTypes.length === 1) {
      // Auto-advance — only one doc type available
      setSelectedType(country.documentTypes[0]);
      setStep(2);
      void launchFlow(country.code, country.documentTypes[0]);
    } else {
      setStep(1);
    }
  }, []);

  const handleTypeSelect = useCallback(
    (docType: string) => {
      if (!selectedCountry) return;
      setSelectedType(docType);
      setStep(2);
      void launchFlow(selectedCountry.code, docType);
    },
    [selectedCountry]
  );

  const launchFlow = useCallback(
    async (countryCode: string, docType: string) => {
      setBusy(true);
      setError(null);
      try {
        const session = await initDocumentScan(countryCode, docType);
        const outcome = await runDocumentFlow(session, Linking.createURL("/passport-scan"));

        if (outcome.status === "submitted") {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          await queryClient.invalidateQueries({ queryKey: ["passport-documents"] });
          setStep(3);
        } else if (outcome.status === "unavailable") {
          setError(outcome.reason || "Verification is unavailable right now.");
          setStep(selectedCountry && selectedCountry.documentTypes.length > 1 ? 1 : 0);
        } else {
          // Dismissed — user closed the browser without completing
          setStep(selectedCountry && selectedCountry.documentTypes.length > 1 ? 1 : 0);
        }
      } catch (e) {
        if (e instanceof ApiError) {
          setError(
            e.correlationId
              ? `${e.message} (ref ${e.correlationId.slice(0, 8)})`
              : e.message
          );
        } else {
          setError((e as Error).message);
        }
        setStep(selectedCountry && selectedCountry.documentTypes.length > 1 ? 1 : 0);
      } finally {
        setBusy(false);
      }
    },
    [queryClient, selectedCountry]
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <SectionHeader title="Add document" />

        <PassportSteps current={step} />

        <ErrorNote message={error} />

        {/* Step 0: Country selection */}
        {step === 0 && !pickerOpen && (
          <Surface style={styles.surface}>
            <Text style={[type.body, { fontWeight: "600" }]}>Issuing country</Text>
            {selectedCountry ? (
              <Pressable
                onPress={() => setPickerOpen(true)}
                style={styles.selectedRow}
                accessibilityRole="button"
                accessibilityLabel={`Change country from ${selectedCountry.name}`}
              >
                <View style={styles.countryChip}>
                  <Text style={styles.countryCode} allowFontScaling={false}>
                    {selectedCountry.code}
                  </Text>
                </View>
                <Text style={type.body}>{selectedCountry.name}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
              </Pressable>
            ) : (
              <Button title="Choose country" onPress={() => setPickerOpen(true)} />
            )}
          </Surface>
        )}

        {step === 0 && !selectedCountry && !pickerOpen && (
          <Button title="Choose country" onPress={() => setPickerOpen(true)} />
        )}

        {/* Step 1: Document type selection */}
        {step === 1 && selectedCountry && (
          <Surface style={styles.surface}>
            <Text style={[type.body, { fontWeight: "600" }]}>Select document type</Text>
            <Text style={type.dim}>
              {selectedCountry.name} supports {selectedCountry.documentTypes.length} document types.
            </Text>
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              {selectedCountry.documentTypes.map((dt) => (
                <Button
                  key={dt}
                  title={dt}
                  variant="secondary"
                  onPress={() => handleTypeSelect(dt)}
                  disabled={busy}
                />
              ))}
            </View>
            <Button
              title="Change country"
              variant="secondary"
              onPress={() => {
                setStep(0);
                setPickerOpen(true);
              }}
              style={{ marginTop: spacing.sm }}
            />
          </Surface>
        )}

        {/* Step 2: Verification in progress */}
        {step === 2 && (
          <Surface style={styles.centerSurface}>
            <Ionicons name="scan-outline" size={40} color={colors.neon} />
            <Text style={[type.h2, { marginTop: spacing.sm }]}>Launching verification…</Text>
            <Text style={[type.dim, styles.centered]}>
              Follow the instructions in your browser to scan your document.
            </Text>
          </Surface>
        )}

        {/* Step 3: Done */}
        {step === 3 && (
          <Surface style={styles.centerSurface}>
            <Ionicons name="checkmark-circle" size={48} color={colors.neon} />
            <Text style={[type.h2, { marginTop: spacing.sm }]}>Document submitted</Text>
            <Text style={[type.dim, styles.centered]}>
              The result arrives from our verification partner, usually within a few minutes. You
              can close this screen — we will update your wallet automatically.
            </Text>
            <Button
              title="Done"
              onPress={() => router.replace("/passport")}
              style={{ marginTop: spacing.lg, alignSelf: "stretch" }}
            />
          </Surface>
        )}

        {/* Hosted flow disclaimer */}
        {step < 2 && (
          <Text style={[type.dim, styles.centered, { marginTop: spacing.md }]}>
            Your document goes directly to our verification partner in a secure browser. FurlPay
            never receives or stores it.
          </Text>
        )}
      </ScrollView>

      <CountryPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleCountrySelect}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  surface: { gap: spacing.sm },
  centerSurface: { alignItems: "center", gap: spacing.xs, paddingVertical: spacing.xl },
  centered: { textAlign: "center" },
  selectedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  countryChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  countryCode: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    includeFontPadding: false,
  },
});
