import React, { useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { isPasskeySupported, passkeyErrorMessage, registerPasskey } from "@/lib/passkey";
import { useSecureScreen } from "@/lib/secureScreen";
import { shortAddress, timeAgo } from "@/lib/format";
import { colors, spacing, type } from "@/lib/theme";
import { Button, EmptyState, ErrorNote, Screen, SectionHeader, Surface } from "@/components/ui";

// Passkey manager — list, enroll, and revoke the WebAuthn credentials that
// control the account. Same /api/auth/passkey/credentials backend as the web
// profile and the extension. The server refuses to remove the last passkey.

interface Credential {
  id: string;
  name: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  transports: string[];
}

export default function Passkeys() {
  useSecureScreen("passkeys");
  const qc = useQueryClient();
  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["passkeys"],
    queryFn: () => api<{ credentials: Credential[]; safeAddress: string }>("/auth/passkey/credentials"),
  });
  const creds = data?.credentials ?? [];

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const enroll = async () => {
    setActionError(null);
    setBusy(true);
    try {
      await registerPasskey();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await qc.invalidateQueries({ queryKey: ["passkeys"] });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : passkeyErrorMessage(e);
      if (!/cancelled/i.test(msg)) setActionError(msg);
    } finally {
      setBusy(false);
    }
  };

  const remove = (c: Credential) => {
    Alert.alert(
      "Remove this passkey?",
      `"${c.name}" will no longer be able to sign in or approve payments. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setActionError(null);
            try {
              await api("/auth/passkey/credentials", {
                method: "DELETE",
                body: { credentialId: c.id },
              });
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              await qc.invalidateQueries({ queryKey: ["passkeys"] });
            } catch (e) {
              setActionError(e instanceof ApiError ? e.message : (e as Error).message);
            }
          },
        },
      ]
    );
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.neon} />
        }
      >
        <Text style={type.dim}>
          Passkeys are hardware-backed keys unlocked by your fingerprint or face. They sign you in
          and approve card challenges — and they only work for furlpay.com, so phishing sites get
          nothing.
        </Text>

        {data?.safeAddress ? (
          <Surface style={{ gap: 2 }}>
            <Text style={type.dim}>Smart account these passkeys control</Text>
            <Text style={type.mono}>{shortAddress(data.safeAddress, 10)}</Text>
          </Surface>
        ) : null}

        <SectionHeader title={`Registered passkeys${creds.length ? ` (${creds.length})` : ""}`} />
        {creds.length === 0 ? (
          <EmptyState
            title={isLoading ? "Loading…" : error ? "Couldn't load passkeys" : "No passkeys yet"}
            subtitle={
              error
                ? (error as Error).message
                : "Enroll this device below — it takes one fingerprint."
            }
          />
        ) : (
          creds.map((c) => (
            <Surface key={c.id} style={styles.credRow}>
              <Ionicons name="finger-print-outline" size={22} color={colors.neon} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.body, { fontWeight: "600" }]}>{c.name}</Text>
                <Text style={type.dim}>
                  {c.createdAt ? `Added ${new Date(c.createdAt).toLocaleDateString()}` : "Added —"}
                  {c.lastUsedAt ? ` · used ${timeAgo(new Date(c.lastUsedAt).getTime())}` : ""}
                </Text>
              </View>
              <Button
                title="Remove"
                variant="outline"
                onPress={() => remove(c)}
                style={{ paddingVertical: 8, paddingHorizontal: 4 }}
              />
            </Surface>
          ))
        )}

        {isPasskeySupported() ? (
          <Button title="Enroll this device" loading={busy} onPress={() => void enroll()} />
        ) : (
          <Text style={type.dim}>
            This device doesn&apos;t support passkeys (Credential Manager unavailable). Manage
            passkeys from the web dashboard instead.
          </Text>
        )}
        <ErrorNote message={actionError} />
        <Text style={[type.dim, { fontSize: 12 }]}>
          You cannot remove your last passkey — add another device first. Losing every passkey
          does not lock you out: email-code sign-in still works.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  credRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
