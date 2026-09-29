"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { INTEREST_OPTIONS } from "@/lib/leads/types";

// ---------------------------------------------------------------------------
// The one client component in the content platform.
//
// Everything else — listings, filters, detail pages — is a server component
// shipping zero JavaScript. This needs state because it is a form with a
// submission lifecycle, and that is the whole justification.
//
// ── THE TWO CONSENTS ARE VISUALLY SEPARATE ─────────────────────────────────
//
// The required consent (the transaction) and the optional marketing opt-in are
// different controls in different visual weights. The marketing box is
// UNCHECKED and its label says what it actually means. A pre-ticked marketing
// box, or one bundled into the required consent, is not consent — and the
// server defaults it to false regardless of what this form sends, so the UI
// and the record cannot disagree.
//
// ── NO SUCCESS THEATRE ─────────────────────────────────────────────────────
//
// On success it shows what actually happened. If the report has no PDF the
// button says "Read online" and links to the page, because there is no file —
// it never renders a Download that would 404.
// ---------------------------------------------------------------------------

export type CaptureKind = "report" | "webinar";

interface Fields {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  jobTitle: string;
  country: string;
  interests: string[];
  consent: boolean;
  marketingConsent: boolean;
}

const EMPTY: Fields = {
  firstName: "",
  lastName: "",
  email: "",
  company: "",
  jobTitle: "",
  country: "",
  interests: [],
  consent: false,
  marketingConsent: false,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface SuccessState {
  downloadUrl?: string | null;
  readUrl?: string;
  joinUrl?: string | null;
}

export default function LeadCaptureForm({
  kind,
  slug,
  submitLabel,
}: {
  kind: CaptureKind;
  slug: string;
  submitLabel: string;
}) {
  const [f, setF] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SuccessState | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setErrors((prev) => ({ ...prev, [k]: undefined }));
  };

  function validate(): boolean {
    const next: Partial<Record<keyof Fields, string>> = {};
    if (!f.firstName.trim()) next.firstName = "Required";
    if (!f.lastName.trim()) next.lastName = "Required";
    if (!EMAIL_RE.test(f.email.trim())) next.email = "Enter a valid email";
    if (!f.company.trim()) next.company = "Required";
    if (!f.jobTitle.trim()) next.jobTitle = "Required";
    if (!f.country.trim()) next.country = "Required";
    if (!f.consent) next.consent = "Please confirm to continue";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !validate()) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const endpoint =
        kind === "report" ? `/api/reports/${slug}/download` : `/api/webinars/${slug}/register`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: f.firstName.trim(),
          lastName: f.lastName.trim(),
          email: f.email.trim(),
          company: f.company.trim(),
          jobTitle: f.jobTitle.trim(),
          country: f.country.trim(),
          interests: f.interests.length ? f.interests : undefined,
          consent: true,
          marketingConsent: f.marketingConsent,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || body.error || `Request failed (${res.status})`);
      }
      setDone(await res.json());
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const href = done.downloadUrl || done.joinUrl || done.readUrl;
    const label = done.downloadUrl
      ? "Download the report"
      : done.joinUrl
        ? "Join the webinar"
        : kind === "report"
          ? "Read online"
          : "View the webinar";
    return (
      <div
        role="status"
        className="rounded-card border border-neon/25 bg-neon/[0.06] p-6 text-center"
      >
        <Check aria-hidden className="mx-auto h-6 w-6 text-neon" />
        <p className="mt-3 text-[16px] font-bold tracking-tight">
          {kind === "report" ? "Your report is ready" : "You are registered"}
        </p>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-textSecondary">
          {kind === "report"
            ? "We have also emailed you the link."
            : "We have emailed your confirmation with the joining details."}
        </p>
        {href && (
          <a href={href} className="btn-green mt-5 inline-block px-6 py-2.5 text-[14px]">
            {label}
          </a>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="firstName" label="First name" value={f.firstName} error={errors.firstName} onChange={(v) => set("firstName", v)} autoComplete="given-name" />
        <Field id="lastName" label="Last name" value={f.lastName} error={errors.lastName} onChange={(v) => set("lastName", v)} autoComplete="family-name" />
      </div>

      <Field
        id="email"
        label="Work email"
        type="email"
        value={f.email}
        error={errors.email}
        onChange={(v) => set("email", v)}
        autoComplete="email"
        // No consumer-domain rejection. The classifier is an internal hint and
        // turning it into a gate would block a founder on a Gmail address.
        hint="Any address works."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="company" label="Company" value={f.company} error={errors.company} onChange={(v) => set("company", v)} autoComplete="organization" />
        <Field id="jobTitle" label="Job title" value={f.jobTitle} error={errors.jobTitle} onChange={(v) => set("jobTitle", v)} autoComplete="organization-title" />
      </div>

      <Field id="country" label="Country" value={f.country} error={errors.country} onChange={(v) => set("country", v)} autoComplete="country-name" />

      <fieldset>
        <legend className="text-[13px] font-semibold text-textPrimary">
          What are you interested in?{" "}
          <span className="font-normal text-textMuted">(optional)</span>
        </legend>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {INTEREST_OPTIONS.map((opt) => {
            const on = f.interests.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  set(
                    "interests",
                    on ? f.interests.filter((i) => i !== opt) : [...f.interests, opt],
                  )
                }
                className={`rounded-pill border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  on
                    ? "border-neon/40 bg-neon/10 text-neon"
                    : "border-white/12 text-textSecondary hover:border-white/25 hover:text-white"
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Required consent. */}
      <label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-textSecondary">
        <input
          type="checkbox"
          checked={f.consent}
          onChange={(e) => set("consent", e.target.checked)}
          aria-invalid={!!errors.consent}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#00E599]"
        />
        <span>
          I agree that FurlPay may use these details to respond to this request.
          {errors.consent && <span className="ml-1 text-loss">{errors.consent}</span>}
        </span>
      </label>

      {/* Optional, separate, and unchecked. */}
      <label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-textSecondary">
        <input
          type="checkbox"
          checked={f.marketingConsent}
          onChange={(e) => set("marketingConsent", e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#00E599]"
        />
        <span>
          Send me occasional FurlPay research, reports, webinars and product updates. You can
          unsubscribe at any time.
        </span>
      </label>

      {submitError && (
        <p role="alert" className="text-[13px] text-loss">
          {submitError}
        </p>
      )}

      <button type="submit" disabled={busy} className="btn-green w-full px-6 py-3 text-[15px] disabled:opacity-60">
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            Submitting…
          </span>
        ) : (
          submitLabel
        )}
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  type = "text",
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  type?: string;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-semibold text-textPrimary">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={`mt-1.5 w-full rounded-lg border bg-white/[0.03] px-3.5 py-2.5 text-[14px]
                    text-textPrimary placeholder:text-textSecondary focus:outline-none ${
                      error ? "border-loss/60" : "border-white/12 focus:border-neon/50"
                    }`}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-[12px] text-loss">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-[12px] text-textMuted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
