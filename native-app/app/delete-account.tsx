import React, { useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { deleteWallet, hasWallet } from "@/lib/wallet";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, ErrorNote, Screen, SectionHeader, Surface } from "@/components/ui";

// ---------------------------------------------------------------------------
// In-app account deletion. Google Play requires an app that creates accounts to
// offer deletion IN the app (not just on a website).
//
// The retention list is fetched from GET /api/account rather than written here,
// so the copy the user reads is generated from the same constant the API
// enforces (lib/accountDeletion.ts RETENTION_NOTICE). The screen physically
// cannot promise an erasure the server does not perform.
//
// The self-custodial wallet is the delicate part. The recovery phrase lives in
// this device's hardware keystore, not on our servers. Erasing it is OPT-IN and
// defaults to OFF: silently destroying it during an account deletion could make
// real on-chain funds permanently unrecoverable, which is a far worse outcome
// than leaving a biometric-gated secret on the user's own device.
// ---------------------------------------------------------------------------

interface Retained {
  record: string;
  reason: string;
}
interface DeletionPreview {
  stepUpSatisfied: boolean;
  retained: Retained[];
}

export default function DeleteAccount() {
  const router = useRouter();
  const forgetSession = useAuth((s) => s.forgetSession);
  const signInWithPasskey = useAuth((s) => s.signInWithPasskey);

  const [confirmText, setConfirmText] = useState("");
  const [alsoEraseWallet, setAlsoEraseWallet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: preview, refetch } = useQuery({
    queryKey: ["account", "deletion-preview"],
    queryFn: () => api<DeletionPreview>("/account"),
  });

  const { data: walletPresent } = useQuery({
    queryKey: ["wallet", "exists"],
    queryFn: () => hasWallet(),
  });

  // Step-up: the server refuses to delete on a bare session. A passkey assertion
  // mints a fresh session AND records the step-up bound to it, so this is the
  // shortest honest path back to an authorized delete.
  const reverify = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithPasskey();
      await refetch();
    } catch {
      setError(
        "Could not re-verify with a passkey on this device. Sign out, sign in again, and return here within 10 minutes."
      );
    } finally {
      setBusy(false);
    }
  };

  const destroy = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/account", { method: "DELETE" });
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.status === 403) {
        return setError("Re-verify your identity, then confirm deletion.");
      }
      return setError(
        e instanceof ApiError
          ? "Deletion failed. Your account is unchanged — please try again."
          : "Network error — your account was not deleted."
      );
    }

    // Server-side account is gone. Only now touch on-device material.
    if (alsoEraseWallet) {
      await deleteWallet().catch(() => {
        // The account IS deleted; a failure to erase the local phrase must not
        // be reported as a failed deletion. The user still holds the phrase.
      });
    }
    await forgetSession();
    router.replace("/(auth)/login");
  };

  if (!preview) return <Screen />;

  const armed = confirmText.trim().toUpperCase() === "DELETE" && !busy;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[type.title, { color: colors.accent }]}>Delete your account</Text>

        <SectionHeader title="This will be deleted" />
        <Surface>
          <Text style={type.body}>
            Your profile and contact details, passkeys and linked sign-ins, balances, cards, bills,
            transaction history, trips, support conversations, agent keys, and push registrations.
            You will be signed out on every device and will not be able to sign in again.
          </Text>
        </Surface>

        <SectionHeader title="This will be kept" />
        <Surface style={{ gap: spacing.sm }}>
          {preview.retained.map((r) => (
            <View key={r.record}>
              <Text style={[type.body, { fontWeight: "600" }]}>{r.record}</Text>
              <Text style={type.dim}>{r.reason}</Text>
            </View>
          ))}
        </Surface>

        {walletPresent && (
          <>
            <SectionHeader title="Your self-custodial wallet" />
            <Surface style={{ gap: spacing.sm }}>
              <Text style={type.body}>
                Your recovery phrase is stored on this device, not by FurlPay. Deleting your account
                does not move or return any on-chain funds, and we cannot recover the phrase for you
                afterwards. If that wallet holds a balance, back up your recovery phrase first.
              </Text>
              <View style={styles.switchRow}>
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Text style={type.body}>Also erase the recovery phrase from this device</Text>
                  <Text style={type.dim}>
                    {alsoEraseWallet
                      ? "Any funds in this wallet become permanently unrecoverable unless you have already backed up the phrase."
                      : "Off — the phrase stays in this device's secure keystore."}
                  </Text>
                </View>
                <Switch
                  value={alsoEraseWallet}
                  onValueChange={setAlsoEraseWallet}
                  trackColor={{ true: colors.accent, false: colors.border }}
                />
              </View>
            </Surface>
          </>
        )}

        {!preview.stepUpSatisfied ? (
          <>
            <SectionHeader title="Re-verify to continue" />
            <Surface>
              <Text style={type.body}>
                Deleting an account is irreversible, so a signed-in session is not enough on its own.
                Confirm it is you.
              </Text>
            </Surface>
            <Button
              title={busy ? "Verifying…" : "Verify with passkey"}
              onPress={() => void reverify()}
              disabled={busy}
            />
          </>
        ) : (
          <>
            <SectionHeader title="Confirm" />
            <Surface style={{ gap: spacing.sm }}>
              <Text style={type.dim}>Type DELETE to confirm.</Text>
              <TextInput
                value={confirmText}
                onChangeText={setConfirmText}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="DELETE"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
              />
            </Surface>
            <Button
              title={busy ? "Deleting…" : "Permanently delete my account"}
              variant="danger"
              onPress={() => void destroy()}
              disabled={!armed}
            />
          </>
        )}

        <ErrorNote message={error} />
        <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  switchRow: { flexDirection: "row", alignItems: "center" },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    fontFamily: "monospace",
    padding: spacing.sm,
  },
});
