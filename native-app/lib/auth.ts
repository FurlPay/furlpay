import { create } from "zustand";
import { api, getToken, setToken, setUnauthorizedHandler } from "./api";
import { authenticateDeviceOwner } from "./biometrics";
import { authenticateWithPasskey, registerPasskey } from "./passkey";
import { unregisterFromPush } from "./push";
import { clearAllCaches } from "./db";
import { queryClient } from "./queries";
import { shutdownWalletConnect } from "./walletconnect/runtime";
import { clearAnalyticsQueue, flushAndClearAnalytics } from "./analytics/activeSink";

/** Wipe everything scoped to a session — the SQLite caches AND the in-memory
 *  react-query cache. Runs on BOTH edges of a session (sign-out and sign-in),
 *  so an account signing in on a shared device can never see the previous
 *  account's balances or transaction history, whichever path the previous
 *  session ended through. */
function clearSessionState(): void {
  // WalletConnect FIRST, and awaited nowhere — see below.
  //
  // A live WalletConnect session is a standing permission over the address this
  // account controls. Wiping the local rows without telling the relay would
  // leave the grant ALIVE and invisible: the dApp could still prompt, and
  // nothing in the UI would list the session to revoke it. So the relay
  // teardown is started here, before the rows go.
  //
  // Deliberately not awaited: `clearSessionState` is synchronous and called
  // from three teardown paths including the 401 handler, and sign-out must not
  // block on a socket to a relay that may be exactly what is unreachable.
  // `shutdownWalletConnect` swallows its own errors and clears the singleton
  // either way; the sessions expire on their own deadline in the worst case.
  void shutdownWalletConnect();

  // Queued analytics belong to the account that recorded them (P2-1, audit
  // 7 Oct 2026); signOut() uploads them first, while its token is still valid.
  clearAnalyticsQueue();

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

/** Outcome of the app-lock gate. `no_device_lock` must be distinguished from
 * an ordinary cancellation so the UI can tell a user how to recover without
 * ever treating an unprotected device as authenticated. */
export type UnlockResult = "unlocked" | "rejected" | "no_device_lock";

/** Which channel an OTP was sent over — the same code path serves both. */
export type OtpChannel = "email" | "sms";

interface AuthState {
  status: AuthStatus;
  email: string | null;
  hydrate: () => Promise<void>;
  /** Device-owner gate: biometrics, or the device PIN/passcode when no
   *  biometric is enrolled. A device with no screen lock remains locked. */
  unlock: () => Promise<UnlockResult>;
  /** Re-arm the lock screen over a live session (backgrounding, idle timeout).
   *  A no-op unless the session is currently unlocked. */
  lock: () => void;
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
  /** Tear down local session state for an account the server has DELETED.
   *  No server round-trips: there is nothing left to sign out of. */
  forgetSession: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: "loading",
  email: null,

  hydrate: async () => {
    const token = await getToken();
    set({ status: token ? "locked" : "signedOut" });
  },

  unlock: async () => {
    // Device-owner proof, not "biometrics if enrolled". The old check asked
    // hasHardware && isEnrolled and, on false, set signedIn and returned true —
    // so on a phone with fingerprint switched off the lock screen unlocked
    // itself the moment it appeared. A device PIN or passcode proves ownership
    // just as well, and authenticateDeviceOwner will prompt for it.
    const result = await authenticateDeviceOwner("Unlock FurlPay");
    if (result.ok) {
      set({ status: "signedIn" });
      return "unlocked";
    }
    // There is no proof of device ownership when the phone has no PIN, pattern
    // or biometric lock. Letting this case through turned the app lock into a
    // visual-only barrier: anyone holding an unlocked, unprotected device got
    // the stored payment session. Keep the session locked and give LockScreen
    // a specific recovery state instead.
    if (result.reason === "no_device_lock") {
      return "no_device_lock";
    }
    return "rejected";
  },

  lock: () => {
    // Only a live session can be re-locked. Doing this from "signedOut" would
    // strand the user on a lock screen with no token behind it, and from
    // "loading" it would race hydrate().
    if (get().status === "signedIn") set({ status: "locked" });
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
    await flushAndClearAnalytics();
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    await setToken(null);
    clearSessionState();
    set({ status: "signedOut", email: null });
  },

  forgetSession: async () => {
    // Local-only teardown for a session whose ACCOUNT NO LONGER EXISTS (after
    // DELETE /api/account). Deliberately skips the server calls signOut() makes:
    // the account is gone, so /auth/logout and the push DELETE would only 401 —
    // and a 401 here would trip the unauthorized handler mid-teardown. The
    // server already revoked the session and dropped the device tokens as part
    // of the deletion itself.
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
