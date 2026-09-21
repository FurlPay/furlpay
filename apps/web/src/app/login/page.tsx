"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  authenticateFingerprint,
  isFingerprintAvailable,
  passkeyErrorMessage,
} from "@/lib/passkey";
import { postJSON } from "@/lib/api";
import { useOnline } from "@/lib/offline";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import AppleSignInButton from "@/components/AppleSignInButton";
import PhoneInput from "@/components/PhoneInput";
import { BiometricMark, PhoneMark } from "@/components/BrandMarks";

export default function LoginPage() {
  const router = useRouter();
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [guestBusy, setGuestBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState(false);

  // Phone OTP sign-in
  const [showPhone, setShowPhone] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);

  useEffect(() => {
    isFingerprintAvailable().then(setFingerprint);
  }, []);

  function enterApp(msg = "Unlocked", delay = 500) {
    setStatus(msg);
    // Middleware sends users here as /login?next=<protected page> — return them
    // there after auth. Same-origin paths only, so the param can't open-redirect.
    const next = new URLSearchParams(window.location.search).get("next");
    const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
    setTimeout(() => router.replace(dest), delay);
  }

  // Demo/guest mode — signs into the seeded demo account without credentials.
  // Rendered + accepted only when the deployment opts in with
  // NEXT_PUBLIC_ALLOW_GUEST=1 (used for device testing and Play review access).
  const guestEnabled = process.env.NEXT_PUBLIC_ALLOW_GUEST === "1";

  // Passkeys/OTP/Google all need the server — sign-in is impossible offline.
  const locked = busy || guestBusy || !online;

  // Guest mode has its own pending flag so the fingerprint button doesn't flip
  // to "Verifying…" (which reads as a biometric check) while the request runs,
  // and redirects immediately on success — no verification, no delay.
  async function guestLogin() {
    setGuestBusy(true);
    setError(null);
    const { ok, data } = await postJSON<{ verified?: boolean; error?: string }>(
      "/api/auth/guest",
      {}
    );
    if (ok && data.verified) {
      enterApp("Guest session", 0);
      return;
    }
    setGuestBusy(false);
    setError(data.error ?? "Guest login is disabled.");
  }

  async function passkeyLogin() {
    setBusy(true);
    setError(null);
    setStatus(fingerprint ? "Awaiting fingerprint…" : "Awaiting passkey…");
    try {
      const verified = await authenticateFingerprint();
      if (verified) enterApp();
      else setError("Verification failed. Try again.");
    } catch (e) {
      setStatus(null);
      setError(passkeyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    if (!phone) return;
    setBusy(true);
    setError(null);
    const { ok, data } = await postJSON<{ sent: boolean; devCode?: string; error?: string }>(
      "/api/auth/otp/start",
      { to: phone, channel: "sms" }
    );
    setBusy(false);
    if (ok && data.sent) {
      setCodeSent(true);
      setDevCode(data.devCode ?? null);
    } else {
      setError(data.error ?? "Couldn't send the code.");
    }
  }

  async function verifyCode() {
    setBusy(true);
    setError(null);
    const { ok, data } = await postJSON<{ verified: boolean; error?: string }>(
      "/api/auth/otp/check",
      { to: phone, code, channel: "sms", login: true }
    );
    setBusy(false);
    if (ok && data.verified) enterApp();
    else setError(data.error ?? "Incorrect code.");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-8 text-center">
      <div className="mb-2 text-4xl font-extrabold tracking-tighter">
        {/* Brand is "FurlPay" -- capital P. furlpay-brand/guidelines/voice-and-tone.md
            is the authority, and 1,463 of the 2,606 brand strings in the app
            already use it. The split is a two-tone treatment, not a different
            spelling, so the capital has to survive the split. */}
        Furl<span className="text-accent">Pay</span>
      </div>
      <p className="mb-8 text-textSecondary">The stablecoin super-app.</p>

      <div className="flex w-full max-w-xs flex-col items-center gap-3">
        {/* Fingerprint / passkey */}
        <button
          onClick={passkeyLogin}
          disabled={locked}
          className="flex w-full items-center justify-center gap-2 rounded-pill bg-accent py-4 text-lg font-semibold disabled:opacity-60"
        >
          {busy ? null : <BiometricMark size={20} />}
          {busy ? "Verifying…" : fingerprint ? "Sign in with Fingerprint" : "Sign in with Passkey"}
        </button>

        {/* Google */}
        <GoogleSignInButton
          onSuccess={(r) => enterApp(`Signed in as ${r.email}`)}
          onError={(m) => setError(m)}
        />

        {/* Apple */}
        <AppleSignInButton
          onSuccess={(r) => enterApp(`Signed in as ${r.email}`)}
          onError={(m) => setError(m)}
        />

        {/* Phone OTP */}
        {!showPhone ? (
          <button
            onClick={() => setShowPhone(true)}
            disabled={locked}
            className="flex w-full items-center justify-center gap-2 rounded-pill border border-white/15 py-3.5 font-semibold disabled:opacity-60"
          >
            <PhoneMark size={18} />
            Sign in with phone number
          </button>
        ) : (
          <div className="w-full space-y-3 rounded-2xl border border-white/10 p-3 text-left">
            {!codeSent ? (
              <>
                <PhoneInput onChange={setPhone} disabled={busy} />
                <button
                  onClick={sendCode}
                  disabled={busy || !phone}
                  className="w-full rounded-pill bg-accent py-3 font-semibold disabled:opacity-50"
                >
                  {busy ? "Sending…" : "Send code"}
                </button>
              </>
            ) : (
              <>
                <p className="text-[13px] text-textSecondary">
                  Enter the 6-digit code sent to {phone}.
                </p>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••••"
                  className="w-full rounded-2xl bg-surface px-4 py-3 text-center text-lg tracking-[0.5em] outline-none"
                />
                {devCode && (
                  <p className="text-[11px] text-textMuted">Dev mode code: {devCode}</p>
                )}
                <button
                  onClick={verifyCode}
                  disabled={busy || code.length !== 6}
                  className="w-full rounded-pill bg-accent py-3 font-semibold disabled:opacity-50"
                >
                  {busy ? "Verifying…" : "Verify & sign in"}
                </button>
                <button onClick={sendCode} disabled={busy} className="w-full text-[12px] text-textSecondary">
                  Resend code
                </button>
              </>
            )}
          </div>
        )}

        {/* Guest / demo — small, only when NEXT_PUBLIC_ALLOW_GUEST=1 */}
        {guestEnabled && (
          <button
            onClick={guestLogin}
            disabled={locked}
            className="mt-1 text-[13px] font-medium text-textSecondary underline underline-offset-4 disabled:opacity-50"
          >
            {guestBusy ? "Entering as guest…" : "Continue as guest"}
          </button>
        )}
      </div>

      {!online && (
        <p className="mt-4 text-sm text-[#FFD60A]">
          You&apos;re offline — connect to the internet to sign in.
        </p>
      )}
      {status && <p className="mt-4 text-sm text-textSecondary">{status}</p>}
      {error && <p className="mt-4 text-sm text-loss">{error}</p>}

      <p className="mt-8 text-sm text-textSecondary">
        New here?{" "}
        <Link href="/signup" className="font-semibold text-accent">Create account</Link>
      </p>
      <p className="mt-3 max-w-xs text-[11px] text-textMuted">
        No passwords. Your fingerprint unlocks a private key that never leaves your device&apos;s secure enclave.
      </p>
    </div>
  );
}
