"use client";

import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";

// Early-access signup: email only up front (lowest friction), then an optional
// "what are you most excited about?" step once the spot is secured. Re-posting
// with the same email updates preferences server-side without losing position.

const INTERESTS = [
  { id: "cards", label: "Cards" },
  { id: "payments", label: "Stablecoin payments" },
  { id: "travel", label: "Travel" },
  { id: "agents", label: "AI agents & x402" },
  { id: "developers", label: "Developer APIs" },
  { id: "everything", label: "Everything" },
] as const;

export default function EarlyAccessSignup({ compact = false }: { compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [position, setPosition] = useState<number | null>(null);
  const [interest, setInterest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join(extra?: { interest?: string }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong — try again.");
        return;
      }
      setPosition(data.position);
      if (extra?.interest) setInterest(extra.interest);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (position !== null) {
    return (
      <div className="rounded-2xl border border-neon/25 bg-neon/[0.05] p-5 text-left">
        <p className="flex items-center gap-2 text-[15px] font-bold text-white">
          <Check className="h-4 w-4 text-neon" aria-hidden /> You&apos;re on the list — position #{position.toLocaleString()}
        </p>
        <p className="mt-1 text-[13px] text-textSecondary">
          We&apos;ll email you the moment your access opens.
        </p>
        {!interest && (
          <>
            <p className="mt-4 text-[12px] font-semibold uppercase tracking-[0.14em] text-textMuted">
              What are you most excited about?
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {INTERESTS.map((i) => (
                <button
                  key={i.id}
                  disabled={busy}
                  onClick={() => join({ interest: i.id })}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12px] text-textSecondary transition-colors hover:border-neon/40 hover:text-neon disabled:opacity-40"
                >
                  {i.label}
                </button>
              ))}
            </div>
          </>
        )}
        {interest && (
          <p className="mt-3 text-[12px] text-textMuted">
            Noted — we&apos;ll prioritize your invite for {INTERESTS.find((i) => i.id === interest)?.label.toLowerCase()}.
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (email.includes("@")) void join();
      }}
      className={compact ? "mx-auto flex max-w-md gap-2" : "flex gap-2"}
    >
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        aria-label="Email address"
        className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[14px] outline-none ring-1 ring-transparent transition focus:ring-neon/40 placeholder:text-textMuted"
      />
      <button
        type="submit"
        disabled={busy}
        className="tap flex shrink-0 items-center gap-1.5 rounded-xl bg-neon px-5 py-3 text-[14px] font-bold text-black transition enabled:hover:bg-neonDeep disabled:opacity-40"
      >
        {busy ? "Joining…" : "Get Early Access"} <ArrowRight className="h-4 w-4" aria-hidden />
      </button>
      {error && <p className="absolute mt-14 text-[12px] text-loss">{error}</p>}
    </form>
  );
}
