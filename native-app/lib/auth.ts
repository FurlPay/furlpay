import { create } from "zustand";
import * as LocalAuthentication from "expo-local-authentication";
import { api, getToken, setToken, setUnauthorizedHandler } from "./api";
import { authenticateWithPasskey, registerPasskey } from "./passkey";
import { unregisterFromPush } from "./push";
import { clearAllCaches } from "./db";
import { queryClient } from "./queries";

/** Wipe everything scoped to a session — the SQLite caches AND the in-memory
 *  react-query cache. Runs on BOTH edges of a session (sign-out and sign-in),
 *  so an account signing in on a shared device can never see the previous
 *  account's balances or transaction history, whichever path the previous
 *  session ended through. */
function clearSessionState(): void {
  try {
    clearAllCaches();
  } catch {
    // A cache wipe failing must not block sign-in/out; the query cache clear
    // below still prevents stale data from rendering this session.
  }
  queryClient.clear();
}

// ---------------------------------------------------------------------------
// Auth state machine:
//   loading   → reading the Keystore on app start
//   signedOut → no session token; show (auth)/login
//   locked    → token present but the biometric gate hasn't passed yet
//   signedIn  → unlocked; show (tabs)
// Login = email OTP (POST /api/auth/otp/start → /check with
// X-Furlpay-Client so the session JWT comes back in the body).
// ---------------------------------------------------------------------------

export type AuthStatus = "loading" | "signedOut" | "locked" | "signedIn";

/** Which channel an OTP was sent over — the same code path serves both. */
export type OtpChannel = "email" | "sms";

interface AuthState {
  status: AuthStatus;
  email: string | null;
  hydrate: () => Promise<void>;
  /** Biometric gate. Falls through when the device has no biometrics enrolled. */
  unlock: () => Promise<boolean>;
  /** Send a one-time code to an email address or an E.164 phone number. */
  startOtp: (to: string, channel?: OtpChannel) => Promise<{ devCode?: string }>;
  verifyOtp: (to: string, code: string, channel?: OtpChannel) => Promise<void>;
  /** Fingerprint sign-in — the secure-enclave passkey the web app promises. */
  signInWithPasskey: () => Promise<void>;
  /** Enroll this device's fingerprint as a passkey (also signs you in). */
  enrollPasskey: () => Promise<void>;
  /** Federated sign-in: the caller does the provider dance, we take the token. */
  signInWithToken: (token: string, email?: string | null) => Promise<void>;
  /** Demo session — only enabled on dev/preview deployments (prod 403s). */
  signInAsGuest: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: "loading",
  email: null,

  hydrate: async () => {
    const token = await getToken();
    set({ status: token ? "locked" : "signedOut" });
  },

  unlock: async () => {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = hasHardware && (await LocalAuthentication.isEnrolledAsync());
    if (!enrolled) {
      set({ status: "signedIn" });
      return true;
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock FurlPay",
      cancelLabel: "Cancel",
    });
    if (result.success) set({ status: "signedIn" });
    return result.success;
  },

  // An email address is normalised to lowercase; an E.164 phone number must be
  // passed through untouched (leading + and digits only).
  startOtp: async (to: string, channel: OtpChannel = "email") => {
    const dest = channel === "email" ? to.trim().toLowerCase() : to.trim();
    const res = await api<{ sent: boolean; devCode?: string }>("/auth/otp/start", {
      method: "POST",
      body: { to: dest, channel },
      anonymous: true,
    });
    return { devCode: res.devCode };
  },

  verifyOtp: async (to: string, code: string, channel: OtpChannel = "email") => {
    const dest = channel === "email" ? to.trim().toLowerCase() : to.trim();
    const res = await api<{ verified: boolean; token?: string }>("/auth/otp/check", {
      method: "POST",
      body: { to: dest, code: code.trim(), channel, login: true },
      anonymous: true,
    });
    if (!res.token) {
      throw new Error("Login succeeded but no session token was returned.");
    }
    clearSessionState();
    await setToken(res.token);
    set({ status: "signedIn", email: channel === "email" ? dest : null });
  },

  signInWithPasskey: async () => {
    const token = await authenticateWithPasskey();
    clearSessionState();
    await setToken(token);
    // The fingerprint WAS the authentication — re-prompting for it to "unlock"
    // would ask the same question twice.
    set({ status: "signedIn" });
  },

  enrollPasskey: async () => {
    const token = await registerPasskey();
    clearSessionState();
    await setToken(token);
    set({ status: "signedIn" });
  },

  signInWithToken: async (token: string, email?: string | null) => {
    clearSessionState();
    await setToken(token);
    set({ status: "signedIn", email: email ?? null });
  },

  signInAsGuest: async () => {
    const res = await api<{ verified: boolean; token?: string }>("/auth/guest", {
      method: "POST",
      anonymous: true,
    });
    if (!res.token) throw new Error("Guest mode is not enabled on this server.");
    clearSessionState();
    await setToken(res.token);
    set({ status: "signedIn", email: null });
  },

  signOut: async () => {
    // Best-effort server-side revocation; local sign-out must not depend on it.
    // Deregister push FIRST — it needs the session token that's about to go.
    await unregisterFromPush();
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    await setToken(null);
    clearSessionState();
    set({ status: "signedOut", email: null });
  },
}));

// A 401 from any API call (expired 1h JWT) drops back to the login screen —
// with the SAME hygiene as a manual sign-out: push deregistration (best-effort;
// the DELETE may itself 401 on an expired token, and unregisterFromPush's
// early-exit on a null registered token keeps the nested 401 from recursing)
// and a full cache wipe, so a forced sign-out never leaves the previous
// account's data behind for the next sign-in.
setUnauthorizedHandler(() => {
  void unregisterFromPush()
    .catch(() => {})
    .then(() => setToken(null))
    .then(() => {
      clearSessionState();
      useAuth.setState({ status: "signedOut", email: null });
    });
});
