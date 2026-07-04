"use client";

import { useState, FormEvent } from "react";
import { Package, Wrench, Scale, Lock, Newspaper, Check } from "lucide-react";

const CATEGORIES = [
  { id: "product-updates", Icon: Package, label: "Product Updates", desc: "New features, launches" },
  { id: "engineering", Icon: Wrench, label: "Engineering", desc: "Technical deep-dives, open source" },
  { id: "policy-changes", Icon: Scale, label: "Policy Changes", desc: "Terms, privacy, compliance updates" },
  { id: "security-bulletins", Icon: Lock, label: "Security Bulletins", desc: "Security advisories, patches" },
  { id: "weekly-digest", Icon: Newspaper, label: "Weekly Digest", desc: "Curated newsletter, market insights" },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

type Variant = "inline" | "card" | "footer" | "minimal";

export default function NewsletterSignup({ variant = "card" }: { variant?: Variant }) {
  const [email, setEmail] = useState("");
  const [categories, setCategories] = useState<CategoryId[]>(["product-updates", "weekly-digest"]);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const toggleCategory = (id: CategoryId) => {
    setCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus("error");
      setMessage("Please enter a valid email address.");
      return;
    }

    setStatus("loading");
    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          categories: variant === "minimal" ? ["product-updates", "weekly-digest"] : categories,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus("success");
        setMessage(data.message ?? "You're subscribed!");
        setEmail("");
      } else {
        setStatus("error");
        setMessage(data.error ?? "Something went wrong.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  };

  const showCategories = variant !== "minimal";

  // ── Inline variant ────────────────────────────────────────────────
  if (variant === "inline") {
    return (
      <div className="glass-card p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
          {/* left: copy */}
          <div className="flex-1">
            <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Newsletter</p>
            <h3 className="mt-2 text-[22px] font-extrabold tracking-tighter">
              Stay in the loop
            </h3>
            <p className="mt-1.5 text-[14px] leading-relaxed text-textSecondary">
              Product updates, engineering deep-dives, security bulletins. No spam, unsubscribe anytime.
            </p>
          </div>

          {/* right: form */}
          <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-3">
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setStatus("idle"); }}
                placeholder="you@company.com"
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[14px] text-white placeholder:text-textMuted outline-none transition-colors focus:border-neon"
              />
              <button
                type="submit"
                disabled={status === "loading"}
                className="btn-green shrink-0 px-6 py-3 text-[14px] disabled:opacity-50"
              >
                {status === "loading" ? "…" : "Subscribe"}
              </button>
            </div>

            {showCategories && (
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => (
                  <label
                    key={cat.id}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition-colors select-none ${
                      categories.includes(cat.id)
                        ? "border-neon/40 bg-neon/10 text-white"
                        : "border-white/10 bg-white/[0.02] text-textMuted hover:border-white/20"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={categories.includes(cat.id)}
                      onChange={() => toggleCategory(cat.id)}
                      className="sr-only"
                    />
                    <cat.Icon className="h-4 w-4" aria-hidden />
                    <span>{cat.label}</span>
                  </label>
                ))}
              </div>
            )}

            <Feedback status={status} message={message} />
          </form>
        </div>
      </div>
    );
  }

  // ── Card / footer / minimal variants ──────────────────────────────
  return (
    <div
      className={
        variant === "footer"
          ? "rounded-2xl border border-white/5 bg-white/[0.02] p-6"
          : variant === "minimal"
            ? ""
            : "glass-card p-8 sm:p-10"
      }
    >
      {variant === "card" && (
        <>
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Newsletter</p>
          <h3 className="mt-2 text-[26px] font-extrabold tracking-tighter sm:text-[32px]">
            Subscribe to Furlpay updates
          </h3>
          <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-textSecondary">
            Choose what you want to hear about. We respect your inbox — no spam, ever.
          </p>
        </>
      )}

      {variant === "footer" && (
        <>
          <p className="text-[14px] font-bold">Stay updated</p>
          <p className="mt-1 text-[13px] text-textSecondary">
            Product launches, engineering deep-dives, and security bulletins.
          </p>
        </>
      )}

      <form onSubmit={handleSubmit} className={variant === "card" ? "mt-8" : "mt-4"}>
        {/* Category checkboxes */}
        {showCategories && (
          <div className="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CATEGORIES.map((cat) => (
              <label
                key={cat.id}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors select-none ${
                  categories.includes(cat.id)
                    ? "border-neon/40 bg-neon/10"
                    : "border-white/10 bg-white/[0.02] hover:border-white/20"
                }`}
              >
                <input
                  type="checkbox"
                  checked={categories.includes(cat.id)}
                  onChange={() => toggleCategory(cat.id)}
                  className="sr-only"
                />
                <cat.Icon className="h-5 w-5 text-textSecondary" aria-hidden />
                <div>
                  <p className="text-[13px] font-semibold text-white">{cat.label}</p>
                  <p className="text-[11px] text-textMuted">{cat.desc}</p>
                </div>
                {categories.includes(cat.id) && (
                  <Check className="ml-auto h-4 w-4 text-neon" aria-hidden />
                )}
              </label>
            ))}
          </div>
        )}

        {/* Email + submit */}
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setStatus("idle"); }}
            placeholder="you@company.com"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[14px] text-white placeholder:text-textMuted outline-none transition-colors focus:border-neon"
          />
          <button
            type="submit"
            disabled={status === "loading"}
            className="btn-green shrink-0 px-6 py-3 text-[14px] disabled:opacity-50"
          >
            {status === "loading" ? "Subscribing…" : "Subscribe"}
          </button>
        </div>

        <Feedback status={status} message={message} />
      </form>
    </div>
  );
}

function Feedback({ status, message }: { status: string; message: string }) {
  if (status === "idle" || status === "loading") return null;
  return (
    <p
      className={`mt-3 text-[13px] font-medium ${
        status === "success" ? "text-neon" : "text-red-400"
      }`}
    >
      {message}
    </p>
  );
}
