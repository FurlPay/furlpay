import React, { useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { authenticateDeviceOwner } from "@/lib/biometrics";
import { useSecureScreen } from "@/lib/secureScreen";
import { STEP_UP_WINDOW_MINUTES, parseOtp, safeReturnPath } from "@/lib/stepUp";
import { spacing, type } from "@/lib/theme";
import { Button, ErrorNote, Field, Screen, Surface } from "@/components/ui";

// Step-up verification. Why each step is here: lib/stepUp.ts.

export default function StepUpScreen() {
  useSecureScreen("step-up");
  const router = useRouter();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = safeReturnPath(params.returnTo);
  const { startOtp, verifyOtp, signInWithPasskey } = useAuth();

  const profile = useQuery({ queryKey: ["profile-email"], queryFn: () => api<{ email?: string | null }>("/profile") });
  const email = profile.data?.email ?? null;

  const [deviceOk, setDeviceOk] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function proveDevice() {
    setError(null);
    const r = await authenticateDeviceOwner("Verify it's you");
    if (r.ok) setDeviceOk(true);
    else setError(r.reason === "no_device_lock" ? "Set a screen lock on this device first." : null);
  }

  async function finish(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      router.replace(returnTo as never);
    } catch {
      setError("Verification failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={type.h2}>Verify it&apos;s you</Text>
        <Text style={type.dim}>
          This transaction needs an extra check. It stays valid for {STEP_UP_WINDOW_MINUTES} minutes and covers one transaction.
        </Text>

        {!deviceOk ? (
          <Button title="Continue" onPress={() => void proveDevice()} />
        ) : (
          <>
            <Surface style={styles.card}>
              <Text style={type.body}>Use your passkey</Text>
              <Button title="Verify with passkey" onPress={() => void finish(signInWithPasskey)} loading={busy} disabled={busy} />
            </Surface>

            <Surface style={styles.card}>
              <Text style={type.body}>Or get a code by email</Text>
              {email ? (
                <>
                  <Text style={type.dim}>We&apos;ll send it to {email}.</Text>
                  {!codeSent ? (
                    <Button
                      title="Send code"
                      variant="secondary"
                      disabled={busy}
                      onPress={() =>
                        void (async () => {
                          setError(null);
                          try {
                            await startOtp(email, "email");
                            setCodeSent(true);
                          } catch {
                            setError("Couldn't send the code. Try again.");
                          }
                        })()
                      }
                    />
                  ) : (
                    <>
                      <Field label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" />
                      <Button
                        title="Verify code"
                        disabled={busy || parseOtp(code) === null}
                        loading={busy}
                        onPress={() => void finish(() => verifyOtp(email, parseOtp(code)!, "email"))}
                      />
                    </>
                  )}
                </>
              ) : (
                <Text style={type.dim}>{profile.isLoading ? "Loading…" : "No email on this account. Use your passkey."}</Text>
              )}
            </Surface>
          </>
        )}

        <ErrorNote message={error} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.md },
  card: { padding: spacing.md, gap: spacing.sm },
});
