import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth, type OtpChannel } from "@/lib/auth";
import { isPasskeySupported, passkeyErrorMessage } from "@/lib/passkey";
import { appleConfigured, googleConfigured, signInWithApple, useGoogleSignIn } from "@/lib/oauth";
import { ApiError, NetworkError } from "@/lib/api";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, ErrorNote, Field, Screen } from "@/components/ui";

// ---------------------------------------------------------------------------
// Sign-in — the native counterpart of apps/web/src/app/login/page.tsx, offering
// the same methods in the same order:
//
//   fingerprint/passkey · Google · Apple · phone · email · guest · create account
//
// Two deliberate differences from the web page:
//
//  1. A method with no server config is HIDDEN, not shown-and-broken. The web
//     page renders every button unconditionally, so Google/Apple/phone currently
//     401/502 the moment they're tapped. Shipping that to a store is worse than
//     shipping fewer buttons: a dead sign-in button at first launch is the most
//     expensive failure an app has.
//  2. The passkey button leads, because it's the only method that needs nothing
//     from a third party — and it's the one the marketing copy promises.
// ---------------------------------------------------------------------------

/** E.164: a leading + and 7–15 digits. Same rule the server enforces. */
const E164 = /^\+\d{7,15}$/;

type Mode = "choose" | "email" | "phone";

export default function Login() {
  const startOtp = useAuth((s) => s.startOtp);
  const verifyOtp = useAuth((s) => s.verifyOtp);
  const signInWithPasskey = useAuth((s) => s.signInWithPasskey);
  const enrollPasskey = useAuth((s) => s.enrollPasskey);
  const signInWithToken = useAuth((s) => s.signInWithToken);
  const signInAsGuest = useAuth((s) => s.signInAsGuest);

  const google = useGoogleSignIn();

  const [mode, setMode] = useState<Mode>("choose");
  const [step, setStep] = useState<"dest" | "code">("dest");
  const [dest, setDest] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passkeyReady, setPasskeyReady] = useState(false);
  const [guestUnavailable, setGuestUnavailable] = useState(false);
  // Seconds until a code can be resent. Starts at 30 when a code is sent and
  // ticks to 0; the server enforces its own 30s cooldown, so the UI mirrors it
  // rather than letting the user fire a request that will just be refused.
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    setPasskeyReady(isPasskeySupported());
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  const channel: OtpChannel = mode === "phone" ? "sms" : "email";

  const destValid = useMemo(() => {
    if (mode === "phone") return E164.test(dest.trim());
    return /^\S+@\S+\.\S+$/.test(dest.trim());
  }, [mode, dest]);

  /** Server errors are already user-facing; network errors are not. */
  const friendly = (e: unknown): string => {
    if (e instanceof NetworkError) return "You're offline — connect to the internet to sign in.";
    if (e instanceof ApiError) return e.message;
    return (e as Error)?.message ?? "Something went wrong.";
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setError(null);
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(null);
    }
  };

  const passkeyLogin = () =>
    run("passkey", async () => {
      try {
        await signInWithPasskey();
      } catch (e) {
        // No credential on this device yet — offer to create one rather than
        // dead-ending on "no passkey found".
        throw new Error(passkeyErrorMessage(e));
      }
    });

  const passkeyCreate = () => run("enroll", () => enrollPasskey());

  const googleLogin = () =>
    run("google", async () => {
      const token = await google.signIn();
      if (token) await signInWithToken(token);
    });

  const appleLogin = () =>
    run("apple", async () => {
      const token = await signInWithApple();
      if (token) await signInWithToken(token);
    });

  const sendCode = () =>
    run("send", async () => {
      const res = await startOtp(dest, channel);
      setDevCode(res.devCode);
      setStep("code");
      setCode("");
      setResendIn(30); // mirror the server's resend cooldown
    });

  // Resend re-runs the same send. The countdown gates the button so we don't
  // fire a request the server's cooldown would refuse.
  const resendCode = () =>
    run("resend", async () => {
      const res = await startOtp(dest, channel);
      setDevCode(res.devCode);
      setCode("");
      setResendIn(30);
    });

  const verify = () =>
    run("verify", async () => {
      await verifyOtp(dest, code, channel);
    });

  const guest = () =>
    run("guest", async () => {
      try {
        await signInAsGuest();
      } catch (e) {
        setGuestUnavailable(true);
        throw e;
      }
    });

  const reset = () => {
    setMode("choose");
    setStep("dest");
    setDest("");
    setCode("");
    setDevCode(undefined);
    setError(null);
    setResendIn(0);
  };

  const anyBusy = busy !== null;

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={{ gap: spacing.xs, alignItems: "center" }}>
            <Text style={type.title}>
              Furl<Text style={{ color: colors.accent }}>pay</Text>
            </Text>
            <Text style={type.dim}>The stablecoin super-app.</Text>
          </View>

          {mode === "choose" ? (
            <View style={{ gap: spacing.sm }}>
              {passkeyReady ? (
                <Button
                  title="Sign in with Fingerprint"
                  variant="accent"
                  loading={busy === "passkey"}
                  disabled={anyBusy}
                  style={styles.pill}
                  onPress={() => void passkeyLogin()}
                />
              ) : null}

              {googleConfigured ? (
                <Button
                  title="Continue with Google"
                  variant="light"
                  icon={<Ionicons name="logo-google" size={18} color="#000000" />}
                  loading={busy === "google"}
                  disabled={anyBusy || !google.ready}
                  style={styles.pill}
                  onPress={() => void googleLogin()}
                />
              ) : null}

              {appleConfigured ? (
                <Button
                  title="Continue with Apple"
                  variant="light"
                  icon={<Ionicons name="logo-apple" size={20} color="#000000" />}
                  loading={busy === "apple"}
                  disabled={anyBusy}
                  style={styles.pill}
                  onPress={() => void appleLogin()}
                />
              ) : null}

              <Button
                title="Sign in with phone number"
                variant="outline"
                disabled={anyBusy}
                style={styles.pill}
                onPress={() => {
                  setMode("phone");
                  setDest("+");
                }}
              />

              <Pressable disabled={anyBusy} onPress={() => setMode("email")} hitSlop={8}>
                <Text style={styles.textLink}>Sign in with email instead</Text>
              </Pressable>

              {!guestUnavailable ? (
                <Pressable disabled={anyBusy} onPress={() => void guest()} hitSlop={8}>
                  {busy === "guest" ? (
                    <ActivityIndicator color={colors.textDim} />
                  ) : (
                    <Text style={styles.textLink}>Continue as guest</Text>
                  )}
                </Pressable>
              ) : null}

              <ErrorNote message={error} />

              {passkeyReady ? (
                <Pressable
                  disabled={anyBusy}
                  onPress={() => void passkeyCreate()}
                  hitSlop={8}
                  style={{ marginTop: spacing.md }}
                >
                  {busy === "enroll" ? (
                    <ActivityIndicator color={colors.accent} />
                  ) : (
                    <Text style={styles.newHere}>
                      New here? <Text style={styles.newHereLink}>Create account</Text>
                    </Text>
                  )}
                </Pressable>
              ) : null}

              <Text style={styles.footnote}>
                No passwords. Your fingerprint unlocks a private key that never leaves your
                device&apos;s secure enclave.
              </Text>
            </View>
          ) : (
            <View style={{ gap: spacing.md }}>
              <Text style={type.dim}>
                {step === "dest"
                  ? mode === "phone"
                    ? "We'll text you a one-time code. New here? The same code creates your account."
                    : "We'll email you a one-time code. New here? The same code creates your account."
                  : `Enter the 6-digit code sent to ${dest.trim()}.`}
              </Text>

              {step === "dest" ? (
                <Field
                  label={mode === "phone" ? "Phone number" : "Email"}
                  value={dest}
                  onChangeText={setDest}
                  placeholder={mode === "phone" ? "+14155550123" : "you@example.com"}
                  autoCapitalize="none"
                  autoComplete={mode === "phone" ? "tel" : "email"}
                  keyboardType={mode === "phone" ? "phone-pad" : "email-address"}
                  autoFocus
                  onSubmitEditing={() => destValid && void sendCode()}
                />
              ) : (
                <Field
                  label="One-time code"
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/\D/g, ""))}
                  placeholder="123456"
                  keyboardType="number-pad"
                  // Android autofills SMS codes; email codes have no OS autofill,
                  // but "one-time-code" is still the correct hint for the field.
                  autoComplete={mode === "phone" ? "sms-otp" : "one-time-code"}
                  textContentType="oneTimeCode"
                  autoFocus
                  maxLength={6}
                  onSubmitEditing={() => void verify()}
                />
              )}

              {step === "code" ? (
                <Pressable
                  disabled={anyBusy || resendIn > 0}
                  onPress={() => void resendCode()}
                  hitSlop={8}
                >
                  {busy === "resend" ? (
                    <ActivityIndicator color={colors.textDim} />
                  ) : (
                    <Text style={[styles.textLink, resendIn > 0 && { opacity: 0.5 }]}>
                      {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
                    </Text>
                  )}
                </Pressable>
              ) : null}

              {devCode ? <Text style={type.dim}>Dev mode — your code is {devCode}</Text> : null}
              <ErrorNote message={error} />

              <Button
                title={step === "dest" ? "Send code" : "Verify & sign in"}
                loading={busy === "send" || busy === "verify"}
                disabled={anyBusy || (step === "dest" ? !destValid : code.length !== 6)}
                onPress={() => void (step === "dest" ? sendCode() : verify())}
              />
              <Button
                title={step === "code" ? "Use a different number or email" : "Back"}
                variant="secondary"
                disabled={anyBusy}
                onPress={reset}
              />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: "center",
    gap: spacing.xl,
    padding: spacing.lg,
  },
  footnote: {
    ...type.dim,
    fontSize: 11,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  pill: {
    borderRadius: radius.pill,
  },
  textLink: {
    ...type.dim,
    fontWeight: "500",
    textAlign: "center",
    textDecorationLine: "underline",
    paddingVertical: spacing.xs,
  },
  newHere: {
    ...type.dim,
    fontSize: 14,
    textAlign: "center",
  },
  newHereLink: {
    color: colors.accent,
    fontWeight: "700",
  },
});
