"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { sendJSON } from "@/lib/api";

interface KycResult {
  status: string;
  provider: string;
  reasons: string[];
  completedInMs: number;
}

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState<"form" | "passkey" | "done">("form");
  const [fullName, setFullName] = useState("");
  const [dob, setDob] = useState("");
  const [doc, setDoc] = useState("");
  const [busy, setBusy] = useState(false);
  const [kyc, setKyc] = useState<KycResult | null>(null);

  async function runKyc() {
    setBusy(true);
    try {
      const r = await sendJSON<{ result: KycResult }>("/api/compliance/kyc", {
        fullName, dateOfBirth: dob, documentNumber: doc, selfieProvided: true,
      });
      setKyc(r.result);
      if (r.result.status === "approved" || r.result.status === "review") setStep("passkey");
    } finally {
      setBusy(false);
    }
  }

  async function createPasskey() {
    setBusy(true);
    try {
      await sendJSON("/api/auth/webauthn", { action: "register", credential: { id: "demo", type: "public-key" } });
      setStep("done");
      setTimeout(() => router.push("/dashboard"), 700);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col justify-center px-8">
      <h1 className="header-title mb-1">Create account</h1>
      <p className="mb-8 text-textSecondary">KYC in under 30 seconds via Persona.</p>

      {step === "form" && (
        <div className="space-y-3">
          <Input label="Full legal name" value={fullName} onChange={setFullName} />
          <Input label="Date of birth" value={dob} onChange={setDob} type="date" />
          <Input label="Document number" value={doc} onChange={setDoc} placeholder="Passport / ID" />
          <button
            onClick={runKyc}
            disabled={busy || !fullName || !dob || !doc}
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

      {step === "passkey" && (
        <div className="space-y-4 text-center">
          <div className="rounded-2xl bg-gain/15 p-3 text-[13px] text-gain">
            Identity {kyc?.status} via {kyc?.provider} in {(kyc!.completedInMs / 1000).toFixed(1)}s
          </div>
          <p className="text-textSecondary">Now secure your account with a passkey.</p>
          <button onClick={createPasskey} disabled={busy} className="w-full rounded-pill bg-accent py-3.5 font-semibold disabled:opacity-50">
            {busy ? "Creating…" : " Create Passkey & Safe wallet"}
          </button>
        </div>
      )}

      {step === "done" && (
        <div className="text-center text-gain">Account ready — deploying your Safe smart account…</div>
      )}

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
