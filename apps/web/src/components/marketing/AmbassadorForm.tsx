"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

const PLATFORMS = ["Instagram", "TikTok", "YouTube", "X / Twitter", "Lemon8", "Blog / Newsletter", "Other"];
const AUDIENCE_BANDS = ["Under 1,000", "1,000 – 10,000", "10,000 – 100,000", "100,000+"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AmbassadorForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [handle, setHandle] = useState("");
  const [audience, setAudience] = useState(AUDIENCE_BANDS[0]);
  const [niche, setNiche] = useState("");
  const [wallet, setWallet] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !EMAIL_RE.test(email.trim()) || !handle.trim()) {
      setError("Please enter your name, a valid email, and your handle.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/ambassadors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, platform, handle, audience, niche, wallet }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Something went wrong.");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-neon/30 bg-neon/[0.06] p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neon/20">
          <Check className="h-6 w-6 text-neon" />
        </div>
        <h3 className="text-lg font-bold text-textPrimary">Application received</h3>
        <p className="mt-2 text-[14px] text-textMuted">
          We review applications in 3–5 business days. If it&apos;s a fit, you&apos;ll get an onboarding kit and your
          Travel Shop link by email.
        </p>
      </div>
    );
  }

  const field = "w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[14px] text-textPrimary placeholder:text-textSecondary focus:border-neon/50 focus:outline-none";

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <input className={field} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={field} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <select className={field} value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {PLATFORMS.map((p) => (
            <option key={p} value={p} className="bg-charcoal">{p}</option>
          ))}
        </select>
        <input className={field} placeholder="@handle or channel URL" value={handle} onChange={(e) => setHandle(e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <select className={field} value={audience} onChange={(e) => setAudience(e.target.value)}>
          {AUDIENCE_BANDS.map((a) => (
            <option key={a} value={a} className="bg-charcoal">{a} followers</option>
          ))}
        </select>
        <input className={field} placeholder="Payout wallet (optional)" value={wallet} onChange={(e) => setWallet(e.target.value)} />
      </div>
      <textarea
        className={`${field} min-h-[90px] resize-y`}
        placeholder="What kind of travel content do you make? (optional)"
        value={niche}
        onChange={(e) => setNiche(e.target.value)}
      />
      {error && <p className="text-[13px] text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-pill bg-neon py-3.5 text-[15px] font-semibold text-black transition-transform hover:-translate-y-0.5 disabled:opacity-60 sm:w-auto sm:px-10"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {busy ? "Submitting…" : "Apply to the Creator Program"}
      </button>
      <p className="text-[12px] text-textSecondary">
        No follower minimum. We prioritize genuine travel content over audience size.
      </p>
    </form>
  );
}
