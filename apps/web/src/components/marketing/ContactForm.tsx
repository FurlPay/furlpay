"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

interface Fields {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  message: string;
}

const EMPTY: Fields = { firstName: "", lastName: "", email: "", phone: "", company: "", message: "" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ContactForm() {
  const [f, setF] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function set<K extends keyof Fields>(k: K, v: string) {
    setF((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  }

  function validate(): boolean {
    const e: Partial<Record<keyof Fields, string>> = {};
    if (!f.firstName.trim()) e.firstName = "First name is required";
    if (!f.lastName.trim()) e.lastName = "Last name is required";
    if (!f.email.trim()) e.email = "Email is required";
    else if (!EMAIL_RE.test(f.email.trim())) e.email = "Enter a valid email";
    if (!f.phone.trim()) e.phone = "Phone number is required";
    if (!f.company.trim()) e.company = "Company name is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setSubmitError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      setDone(true);
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="glass-card p-10 text-center">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-neon/15 text-neon">
          <Check className="h-7 w-7" />
        </span>
        <h2 className="text-[22px] font-bold tracking-tight">Thanks, {f.firstName}.</h2>
        <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-textSecondary">
          We&apos;ve got your details and a specialist will reach out within 24 hours at{" "}
          <span className="text-white">{f.email}</span>.
        </p>
        <button
          onClick={() => {
            setF(EMPTY);
            setDone(false);
          }}
          className="mt-6 text-[13px] font-semibold text-neon hover:underline"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="glass-card space-y-5 p-6 sm:p-8">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="First name" required error={errors.firstName}>
          <input
            value={f.firstName}
            onChange={(e) => set("firstName", e.target.value)}
            placeholder="Enter first name here"
            className={inputCls(errors.firstName)}
            autoComplete="given-name"
          />
        </Field>
        <Field label="Last name" required error={errors.lastName}>
          <input
            value={f.lastName}
            onChange={(e) => set("lastName", e.target.value)}
            placeholder="Enter last name here"
            className={inputCls(errors.lastName)}
            autoComplete="family-name"
          />
        </Field>
      </div>

      <Field label="Email" required error={errors.email}>
        <input
          type="email"
          value={f.email}
          onChange={(e) => set("email", e.target.value)}
          placeholder="example@address.com"
          className={inputCls(errors.email)}
          autoComplete="email"
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Phone number" required error={errors.phone}>
          <input
            type="tel"
            value={f.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="07654 123456"
            className={inputCls(errors.phone)}
            autoComplete="tel"
          />
        </Field>
        <Field label="Company name" required error={errors.company}>
          <input
            value={f.company}
            onChange={(e) => set("company", e.target.value)}
            placeholder="Enter business name here"
            className={inputCls(errors.company)}
            autoComplete="organization"
          />
        </Field>
      </div>

      <Field label="Message">
        <textarea
          value={f.message}
          onChange={(e) => set("message", e.target.value)}
          placeholder="Optional"
          rows={4}
          className={`${inputCls(undefined)} resize-none`}
        />
      </Field>

      {submitError && (
        <div className="rounded-2xl bg-loss/15 px-4 py-3 text-[13px] text-loss">{submitError}</div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="btn-green flex w-full items-center justify-center gap-2 py-3.5 text-[15px] disabled:opacity-60"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {busy ? "Sending…" : "Reach out to us"}
      </button>

      <p className="text-center text-[11px] text-textMuted">
        By submitting, you agree to our{" "}
        <a href="/legal/privacy" className="underline hover:text-white">Privacy Policy</a>. We&apos;ll only
        use your details to respond.
      </p>
    </form>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-textSecondary">
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-[12px] text-loss">{error}</span>}
    </label>
  );
}

function inputCls(error?: string): string {
  return `w-full rounded-2xl border bg-surface px-4 py-3 text-[15px] outline-none transition placeholder:text-textMuted focus:ring-1 ${
    error ? "border-loss/60 focus:ring-loss/40" : "border-white/10 focus:border-neon/40 focus:ring-neon/30"
  }`;
}
