"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { sendJSON } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function passkeyLogin() {
    setBusy(true);
    setStatus("Requesting challenge…");
    try {
      await sendJSON("/api/auth/webauthn", { action: "login" });
      setStatus("Awaiting Face ID / Touch ID…");
      // Simulate the WebAuthn assertion signed by the device enclave.
      const r = await sendJSON<{ success: boolean; safeAddress: string }>("/api/auth/webauthn", {
        action: "login",
        credential: { id: "demo", type: "public-key" },
      });
      if (r.success) {
        setStatus("Unlocked");
        setTimeout(() => router.push("/dashboard"), 500);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-8 text-center">
      <div className="mb-2 text-4xl font-extrabold tracking-tighter">
        Furl<span className="text-accent">pay</span>
      </div>
      <p className="mb-10 text-textSecondary">The stablecoin super-app.</p>

      <button
        onClick={passkeyLogin}
        disabled={busy}
        className="w-full max-w-xs rounded-pill bg-accent py-4 text-lg font-semibold disabled:opacity-60"
      >
        {busy ? "Verifying…" : " Sign in with Passkey"}
      </button>

      {status && <p className="mt-4 text-sm text-textSecondary">{status}</p>}

      <p className="mt-8 text-sm text-textSecondary">
        New here?{" "}
        <Link href="/signup" className="font-semibold text-accent">Create account</Link>
      </p>
      <p className="mt-3 max-w-xs text-[11px] text-textMuted">
        No passwords. Your private key never leaves your device&apos;s secure enclave.
      </p>
    </div>
  );
}
