import { create } from "zustand";
import * as LocalAuthentication from "expo-local-authentication";
import { api, getToken, setToken, setUnauthorizedHandler } from "./api";
import { clearAllCaches } from "./db";

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

interface AuthState {
  status: AuthStatus;
  email: string | null;
  hydrate: () => Promise<void>;
  /** Biometric gate. Falls through when the device has no biometrics enrolled. */
  unlock: () => Promise<boolean>;
  startOtp: (email: string) => Promise<{ devCode?: string }>;
  verifyOtp: (email: string, code: string) => Promise<void>;
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

  startOtp: async (email: string) => {
    const res = await api<{ sent: boolean; devCode?: string }>("/auth/otp/start", {
      method: "POST",
      body: { to: email.trim().toLowerCase(), channel: "email" },
      anonymous: true,
    });
    return { devCode: res.devCode };
  },

  verifyOtp: async (email: string, code: string) => {
    const res = await api<{ verified: boolean; token?: string }>("/auth/otp/check", {
      method: "POST",
      body: { to: email.trim().toLowerCase(), code: code.trim(), channel: "email", login: true },
      anonymous: true,
    });
    if (!res.token) {
      throw new Error("Login succeeded but no session token was returned.");
    }
    await setToken(res.token);
    set({ status: "signedIn", email: email.trim().toLowerCase() });
  },

  signInAsGuest: async () => {
    const res = await api<{ verified: boolean; token?: string }>("/auth/guest", {
      method: "POST",
      anonymous: true,
    });
    if (!res.token) throw new Error("Guest mode is not enabled on this server.");
    await setToken(res.token);
    set({ status: "signedIn", email: null });
  },

  signOut: async () => {
    // Best-effort server-side revocation; local sign-out must not depend on it.
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    await setToken(null);
    clearAllCaches();
    set({ status: "signedOut", email: null });
  },
}));

// A 401 from any API call (expired 1h JWT) drops back to the login screen.
setUnauthorizedHandler(() => {
  void setToken(null).then(() => {
    useAuth.setState({ status: "signedOut" });
  });
});
