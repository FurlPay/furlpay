"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

const ROLES = [
  "Senior Full-Stack Engineer",
  "Solana / Rust Engineer",
  "Developer Relations",
  "Security Engineer",
  "Compliance Generalist",
  "Technical Writer",
  "Community Manager",
  "Product Designer",
  "Open-source contributor",
  "Something else",
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CareersForm({ defaultRole }: { defaultRole?: string } = {}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(defaultRole && ROLES.includes(defaultRole) ? defaultRole : ROLES[0]);
  const [links, setLinks] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !EMAIL_RE.test(email.trim())) {
      setError("Please enter your name and a valid email.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/careers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, role, links }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Something went wrong.");
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="glass-card p-8 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neon/15 text-neon">
          <Check className="h-6 w-6" />
        </span>
        <p className="text-[17px] font-bold">You&apos;re on the list, {name.split(" ")[0]}.</p>
        <p className="mt-1.5 text-[13px] text-textSecondary">
          We&apos;ll reach out when we open the <span className="text-white">{role}</span> role.
        </p>
      </div>
    );
  }

  const input =
    "w-full rounded-2xl border border-white/10 bg-surface px-4 py-3 text-[15px] outline-none transition focus:border-neon/40 focus:ring-1 focus:ring-neon/30 placeholder:text-textMuted";

  return (
    <form onSubmit={submit} noValidate className="glass-card space-y-4 p-6 sm:p-8">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={input} autoComplete="name" />
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" className={input} autoComplete="email" />
      <select value={role} onChange={(e) => setRole(e.target.value)} className={input} aria-label="Role of interest">
        {ROLES.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
      <input value={links} onChange={(e) => setLinks(e.target.value)} placeholder="GitHub / portfolio / LinkedIn (optional)" className={input} />
      {error && <p className="rounded-2xl bg-loss/15 px-4 py-3 text-[13px] text-loss">{error}</p>}
      <button type="submit" disabled={busy} className="btn-green flex w-full items-center justify-center gap-2 py-3.5 text-[15px] disabled:opacity-60">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {busy ? "Joining…" : "Join the talent pipeline"}
      </button>
      <p className="text-center text-[11px] text-textMuted">No spam. We&apos;ll only email you about roles.</p>
    </form>
  );
}
