import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/lib/auth";
import { ApiError, NetworkError } from "@/lib/api";
import { colors, spacing, type } from "@/lib/theme";
import { Button, ErrorNote, Field, Screen } from "@/components/ui";

export default function Login() {
  const startOtp = useAuth((s) => s.startOtp);
  const verifyOtp = useAuth((s) => s.verifyOtp);

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitEmail = async () => {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      const res = await startOtp(email);
      setDevCode(res.devCode);
      setStep("code");
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setError(null);
    setBusy(true);
    try {
      await verifyOtp(email, code);
      // (auth)/_layout redirects to (tabs) once status flips to signedIn.
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.container}
      >
        <View style={{ gap: spacing.sm }}>
          <Text style={type.title}>FurlPay</Text>
          <Text style={type.dim}>
            {step === "email"
              ? "Sign in with your email — we'll send a one-time code."
              : `Enter the 6-digit code sent to ${email.trim()}.`}
          </Text>
        </View>

        <View style={{ gap: spacing.md }}>
          {step === "email" ? (
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              autoFocus
              onSubmitEditing={() => void submitEmail()}
            />
          ) : (
            <Field
              label="One-time code"
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              keyboardType="number-pad"
              autoFocus
              maxLength={10}
              onSubmitEditing={() => void submitCode()}
            />
          )}
          {devCode ? (
            <Text style={type.dim}>Dev mode — your code is {devCode}</Text>
          ) : null}
          <ErrorNote message={error} />
          <Button
            title={step === "email" ? "Send code" : "Verify & sign in"}
            loading={busy}
            onPress={() => void (step === "email" ? submitEmail() : submitCode())}
          />
          {step === "code" ? (
            <Button
              title="Use a different email"
              variant="secondary"
              onPress={() => {
                setStep("email");
                setCode("");
                setDevCode(undefined);
                setError(null);
              }}
            />
          ) : null}
        </View>

        <Text style={[type.dim, { textAlign: "center", color: colors.textFaint }]}>
          Stablecoin payments, cards & investing — furlpay.com
        </Text>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function friendly(e: unknown): string {
  if (e instanceof NetworkError) return "You appear to be offline — try again when connected.";
  if (e instanceof ApiError) return e.message;
  return (e as Error).message || "Something went wrong.";
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "space-between",
    padding: spacing.lg,
    paddingVertical: spacing.xl * 2,
  },
});
