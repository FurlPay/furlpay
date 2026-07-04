"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { Package, Wrench, Scale, Lock, Newspaper } from "lucide-react";

const CATEGORIES = [
  { id: "product-updates", Icon: Package, label: "Product Updates" },
  { id: "engineering", Icon: Wrench, label: "Engineering" },
  { id: "policy-changes", Icon: Scale, label: "Policy Changes" },
  { id: "security-bulletins", Icon: Lock, label: "Security Bulletins" },
  { id: "weekly-digest", Icon: Newspaper, label: "Weekly Digest" },
];

export default function UnsubscribePage() {
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  const submit = async (categories?: string[]) => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus("error");
      setMessage("Please enter a valid email address.");
      return;
    }

    setStatus("loading");
    try {
      const res = await fetch("/api/newsletter/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, categories }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus("success");
        setMessage(data.message);
      } else {
        setStatus("error");
        setMessage(data.error ?? "Something went wrong.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  };

  const handleSelectiveUnsubscribe = (e: FormEvent) => {
    e.preventDefault();
    if (selected.length === 0) {
      setStatus("error");
      setMessage("Select at least one category to unsubscribe from, or use the button below.");
      return;
    }
    submit(selected);
  };

  return (
    <div className="min-h-screen bg-oled">
      {/* Simple header */}
      <header className="border-b border-white/5 bg-black/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.png" alt="Furlpay" width={28} height={28} className="h-7 w-7 rounded-lg" />
            <span className="text-xl font-extrabold tracking-tighter">Furlpay</span>
          </Link>
          <Link href="/newsletter" className="text-sm text-textSecondary transition-colors hover:text-white">
            ← Newsletter
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-6 pb-24 pt-14">
        <h1 className="text-[32px] font-extrabold tracking-tighter sm:text-[40px]">
          Manage your subscription
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-textSecondary">
          Unsubscribe from specific categories or remove yourself entirely.
          We&apos;ll miss you either way.
        </p>

        {status === "success" ? (
          <div className="mt-10 glass-card p-8 text-center">
            <p className="text-[20px] font-bold text-neon">Done!</p>
            <p className="mt-2 text-[14px] text-textSecondary">{message}</p>
            <Link href="/newsletter" className="mt-6 inline-block btn-outline px-6 py-3 text-[14px]">
              Back to newsletter
            </Link>
          </div>
        ) : (
          <>
            {/* Email input */}
            <div className="mt-8">
              <label className="text-[12px] font-semibold uppercase tracking-[0.18em] text-textMuted">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setStatus("idle"); }}
                placeholder="you@company.com"
                className="mt-2 block w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[14px] text-white placeholder:text-textMuted outline-none transition-colors focus:border-neon"
              />
            </div>

            {/* Selective unsubscribe */}
            <form onSubmit={handleSelectiveUnsubscribe} className="mt-8">
              <p className="text-[13px] font-semibold text-white">
                Unsubscribe from specific categories
              </p>
              <div className="mt-3 grid grid-cols-1 gap-2">
                {CATEGORIES.map((cat) => (
                  <label
                    key={cat.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors select-none ${
                      selected.includes(cat.id)
                        ? "border-red-400/40 bg-red-400/10"
                        : "border-white/10 bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(cat.id)}
                      onChange={() => toggle(cat.id)}
                      className="sr-only"
                    />
                    <cat.Icon className="h-5 w-5 text-textSecondary" aria-hidden />
                    <span className="text-[13px] text-white">{cat.label}</span>
                    {selected.includes(cat.id) && (
                      <span className="ml-auto text-[12px] text-red-400">remove</span>
                    )}
                  </label>
                ))}
              </div>
              <button
                type="submit"
                disabled={status === "loading"}
                className="btn-outline mt-4 w-full py-3 text-[14px] disabled:opacity-50"
              >
                {status === "loading" ? "Processing…" : "Unsubscribe from selected"}
              </button>
            </form>

            {/* Full unsubscribe */}
            <div className="mt-8 border-t border-white/10 pt-8">
              <button
                onClick={() => submit()}
                disabled={status === "loading"}
                className="w-full rounded-xl border border-red-500/30 bg-red-500/10 py-3 text-[14px] font-semibold text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                Unsubscribe from all emails
              </button>
            </div>

            {status === "error" && (
              <p className="mt-4 text-[13px] font-medium text-red-400">{message}</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
