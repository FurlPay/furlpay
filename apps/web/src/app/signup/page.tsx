"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { postJSON, sendJSON } from "@/lib/api";
import {
  isFingerprintAvailable,
  passkeyErrorMessage,
  registerFingerprint,
} from "@/lib/passkey";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import PhoneInput from "@/components/PhoneInput";

interface KycResult {
  status: string;
  provider: string;
  reasons: string[];
  completedInMs: number;
}

type Step = "form" | "otp" | "passkey" | "done";

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("form");
  const [fullName, setFullName] = useState("");
  const [dob, setDob] = useState("");
  const [doc, setDoc] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState<string | null>(null); // E.164, mandatory
  const [googleLinked, setGoogleLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kyc, setKyc] = useState<KycResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState(false);

  // Phone OTP step
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);

  useEffect(() => {
    isFingerprintAvailable().then(setFingerprint);
  }, []);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const canVerify = !!fullName && !!dob && !!doc && emailValid && !!phone && !busy;

  async function runKyc() {
    setBusy(true);
    setError(null);
    try {
      const r = await sendJSON<{ result: KycResult }>("/api/compliance/kyc", {
        fullName, dateOfBirth: dob, documentNumber: doc, selfieProvided: true,
      });
      setKyc(r.result);
      if (r.result.status === "approved" || r.result.status === "review") {
        await sendCode();
        setStep("otp");
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    if (!phone) return;
    setError(null);
    const { ok, data } = await postJSON<{ sent: boolean; devCode?: string; error?: string }>(
      "/api/auth/otp/start",
      { to: phone, channel: "sms" }
    );
    if (ok && data.sent) setDevCode(data.devCode ?? null);
    else setError(data.error ?? "Couldn't send the verification code.");
  }

  async function verifyPhone() {
    setBusy(true);
    setError(null);
    // login:false — just confirm the number; the fingerprint step issues the session.
    const { ok, data } = await postJSON<{ verified: boolean; error?: string }>(
      "/api/auth/otp/check",
      { to: phone, code, channel: "sms", login: false }
    );
    setBusy(false);
    if (ok && data.verified) setStep("passkey");
    else setError(data.error ?? "Incorrect code.");
  }

  async function createPasskey() {
    setBusy(true);
    setError(null);
    try {
      const verified = await registerFingerprint();
      if (!verified) {
        setError("Enrollment could not be verified. Please try again.");
        return;
      }
      setStep("done");
      setTimeout(() => router.push("/dashboard"), 700);
    } catch (e) {
      setError(passkeyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col justify-center px-8">
      <h1 className="header-title mb-1">Create account</h1>
      <p className="mb-6 text-textSecondary">KYC in under 30 seconds via Persona.</p>

      {step === "form" && (
        <div className="space-y-3">
          <div className="flex justify-center">
            <GoogleSignInButton
              onSuccess={(r) => {
                setEmail(r.email);
                if (r.name) setFullName(r.name);
                setGoogleLinked(true);
              }}
              onError={setError}
            />
          </div>
          <div className="flex items-center gap-3 py-1 text-[11px] text-textMuted">
            <div className="h-px flex-1 bg-white/10" /> or <div className="h-px flex-1 bg-white/10" />
          </div>

          <Input label="Full legal name" value={fullName} onChange={setFullName} />
          <Input
            label={`Email${googleLinked ? " (from Google)" : ""}`}
            value={email}
            onChange={setEmail}
            type="email"
            placeholder="you@example.com"
          />
          <div>
            <label className="mb-1 block text-[12px] text-textSecondary">
              Mobile number <span className="text-accent">(required)</span>
            </label>
            <PhoneInput onChange={setPhone} disabled={busy} />
          </div>
          <Input label="Date of birth" value={dob} onChange={setDob} type="date" />
          <Input label="Document number" value={doc} onChange={setDoc} placeholder="Passport / ID" />
          <button
            onClick={runKyc}
            disabled={!canVerify}
            className="mt-2 w-full rounded-pill bg-accent py-3.5 font-semibold disabled:opacity-50"
          >
            {busy ? "Verifying identity…" : "Verify identity"}
          </button>
          {kyc && kyc.status === "rejected" && (
            <div className="rounded-2xl bg-loss/15 p-3 text-[13px] text-loss">
              KYC rejected: {kyc.reasons.join(", ")}
            </div>
          )}
        </div>
      )}

      {step === "otp" && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-gain/15 p-3 text-[13px] text-gain">
            Identity {kyc?.status} via {kyc?.provider} in {(kyc!.completedInMs / 1000).toFixed(1)}s
          </div>
          <p className="text-textSecondary">
            We sent a 6-digit code to <span className="text-textPrimary">{phone}</span>. Enter it to verify your number.
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
          {devCode && <p className="text-[11px] text-textMuted">Dev mode code: {devCode}</p>}
          <button
            onClick={verifyPhone}
            disabled={busy || code.length < 4}
            className="w-full rounded-pill bg-accent py-3.5 font-semibold disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Verify number"}
          </button>
          <button onClick={sendCode} disabled={busy} className="w-full text-[12px] text-textSecondary">
            Resend code
          </button>
        </div>
      )}

      {step === "passkey" && (
        <div className="space-y-4 text-center">
          <div className="rounded-2xl bg-gain/15 p-3 text-[13px] text-gain">
            Phone {phone} verified ✓
          </div>
          <p className="text-textSecondary">
            {fingerprint
              ? "Now secure your account with your fingerprint."
              : "Now secure your account with a passkey."}
          </p>
          <button onClick={createPasskey} disabled={busy} className="w-full rounded-pill bg-accent py-3.5 font-semibold disabled:opacity-50">
            {busy
              ? "Creating…"
              : fingerprint
                ? " Enroll Fingerprint & create Safe wallet"
                : " Create Passkey & Safe wallet"}
          </button>
        </div>
      )}

      {step === "done" && (
        <div className="text-center text-gain">Account ready — deploying your Safe smart account…</div>
      )}

      {error && <p className="mt-4 text-center text-sm text-loss">{error}</p>}

      <p className="mt-8 text-center text-sm text-textSecondary">
        Already have an account? <Link href="/login" className="font-semibold text-accent">Sign in</Link>
      </p>
    </div>
  );
}

function Input({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div>
      <label className="mb-1 block text-[12px] text-textSecondary">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl bg-surface px-4 py-3 outline-none"
      />
    </div>
  );
}
