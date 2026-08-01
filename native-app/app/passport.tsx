import React, { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { Button, Screen, SectionHeader, Sheet, StatusBadge, SummaryRow, Surface } from "@/components/ui";
import { PassportCardStack } from "@/components/PassportCardStack";
import type { TravelDocumentView } from "@/components/PassportCard";
import { useSecureScreen } from "@/lib/secureScreen";
import { colors, spacing, type } from "@/lib/theme";
import { deleteDocument, fetchDocuments, updateDocument } from "@/lib/passport";

// Passport wallet screen — lists the user's verified travel documents in an
// Apple Wallet-style card stack. Tapping a card opens detail in a sheet.
//
// The screen uses screenshot protection (useSecureScreen) because the card
// shows a partial document number, and a screenshot of that circulating is a
// mild identity-theft risk.

export default function PassportWalletScreen() {
  useSecureScreen("passport");
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["passport-documents"],
    queryFn: fetchDocuments,
  });

  const documents = data?.documents ?? [];

  const [selectedDoc, setSelectedDoc] = useState<TravelDocumentView | null>(null);

  const deleteMutation = useMutation({
    mutationFn: deleteDocument,
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void queryClient.invalidateQueries({ queryKey: ["passport-documents"] });
      setSelectedDoc(null);
    },
    onError: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const setPrimaryMutation = useMutation({
    mutationFn: (id: string) => updateDocument(id, { isPrimary: true }),
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void queryClient.invalidateQueries({ queryKey: ["passport-documents"] });
      setSelectedDoc(null);
    },
    onError: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const confirmDelete = (docId: string) => {
    Alert.alert(
      "Remove document",
      "Are you sure you want to remove this document? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => deleteMutation.mutate(docId),
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.neon} />
        </View>
      </Screen>
    );
  }

  // A FAILED read must never render as an empty wallet. `data` is undefined
  // both when the user has no documents and when the request failed, so
  // without this branch someone whose network dropped is told they have no
  // passport — the same "0 vs unknown" confusion the balances screens avoid.
  if (isError) {
    return (
      <Screen>
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={44} color={colors.textFaint} />
          <Text style={[type.h2, { textAlign: "center" }]}>Couldn&apos;t load your documents</Text>
          <Text style={[type.dim, { textAlign: "center" }]}>
            {error instanceof Error ? error.message : "Check your connection and try again."}
          </Text>
          <Button
            title={isRefetching ? "Retrying…" : "Try again"}
            onPress={() => void refetch()}
            loading={isRefetching}
            style={{ alignSelf: "stretch" }}
          />
        </View>
      </Screen>
    );
  }

  const hasDocs = documents.length > 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <SectionHeader
          title="Travel documents"
          right={hasDocs ? <Text style={type.dim}>{documents.length} {documents.length === 1 ? "document" : "documents"}</Text> : undefined}
        />

        {!hasDocs ? (
          <Surface style={styles.emptyCard}>
            <Ionicons name="globe-outline" size={48} color={colors.neon} />
            <Text style={[type.h2, { marginTop: spacing.sm }]}>Your document wallet</Text>
            <Text style={[type.dim, styles.centered]}>
              Add a passport or national ID to keep your travel documents ready.
            </Text>
            <Button
              title="Add document"
              onPress={() => router.push("/passport-scan")}
              style={{ marginTop: spacing.md, alignSelf: "stretch" }}
            />
          </Surface>
        ) : (
          <>
            <PassportCardStack documents={documents} onPressDocument={setSelectedDoc} />
            <Button title="Add another document" variant="secondary" onPress={() => router.push("/passport-scan")} />
          </>
        )}

        <Text style={[type.dim, styles.centered, { marginTop: spacing.xl }]}>
          Documents are verified by our identity partner in a secure browser. FurlPay never receives
          or stores images.
        </Text>
      </ScrollView>

      <Sheet open={!!selectedDoc} onClose={() => setSelectedDoc(null)} title="Document details">
        {selectedDoc ? (
          <View style={{ gap: spacing.md, paddingBottom: spacing.xl }}>
            <SummaryRow k="Country" v={selectedDoc.countryName} />
            <SummaryRow k="Type" v={selectedDoc.typeLabel} />
            <SummaryRow k="Document number" v={selectedDoc.documentNumberMasked} />
            <SummaryRow k="Expiry" v={formatExpiry(selectedDoc.expiresOn)} />

            <View style={styles.row}>
              <Text style={type.dim}>Status</Text>
              <StatusBadge status={selectedDoc.status} />
            </View>

            <View style={styles.row}>
              <Text style={type.dim}>Chip verified</Text>
              <Text style={type.body}>{selectedDoc.chipVerified ? "Yes" : "No"}</Text>
            </View>

            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              {!selectedDoc.isPrimary && selectedDoc.status === "verified" && (
                <Button
                  title="Set as primary"
                  onPress={() => setPrimaryMutation.mutate(selectedDoc.id)}
                  loading={setPrimaryMutation.isPending}
                />
              )}
              <Button
                title="Remove document"
                variant="danger"
                onPress={() => confirmDelete(selectedDoc.id)}
                loading={deleteMutation.isPending}
              />
            </View>
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyCard: { alignItems: "center", gap: spacing.xs, paddingVertical: spacing.xl },
  centered: { textAlign: "center" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
