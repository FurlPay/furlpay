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
import GoogleSignInButton from "@/components/GoogleSignInButton";
import PhoneInput from "@/components/PhoneInput";

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
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

  function enterApp(msg = "Unlocked") {
    setStatus(msg);
    setTimeout(() => router.push("/dashboard"), 500);
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
        Furl<span className="text-accent">pay</span>
      </div>
      <p className="mb-8 text-textSecondary">The stablecoin super-app.</p>

      <div className="flex w-full max-w-xs flex-col items-center gap-3">
        {/* Fingerprint / passkey */}
        <button
          onClick={passkeyLogin}
          disabled={busy}
          className="w-full rounded-pill bg-accent py-4 text-lg font-semibold disabled:opacity-60"
        >
          {busy ? "Verifying…" : fingerprint ? " Sign in with Fingerprint" : " Sign in with Passkey"}
        </button>

        {/* Google */}
        <GoogleSignInButton
          onSuccess={(r) => enterApp(`Signed in as ${r.email}`)}
          onError={(m) => setError(m)}
        />

        {/* Phone OTP */}
        {!showPhone ? (
          <button
            onClick={() => setShowPhone(true)}
            className="w-full rounded-pill border border-white/15 py-3.5 font-semibold"
          >
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
                  disabled={busy || code.length < 4}
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
      </div>

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
