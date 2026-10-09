"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, AtSign, CheckCircle2, Globe2, Linkedin, MessageCircle, Phone, Send, X } from "lucide-react";
import { CONTACT_METHODS, PARTNERSHIP_INTERESTS, validateInquiry, type ContactMethod, type PartnershipInterest } from "@/lib/partnerships/model";
import { trackEvent } from "@/lib/analytics/vercelEvents";
import PartnershipSelect from "./PartnershipSelect";

// The "Let's build together" dialog. Accessible modal (labelled dialog, focus
// trapped and restored, Escape, scroll lock), a form validated by the same
// schema the server uses, and a success state shown only after the server
// confirms the inquiry was STORED. Entered data survives any recoverable error.

const PaymentsGlobe = dynamic(() => import("@/components/globe/PaymentsGlobe"), { ssr: false, loading: () => null });

const CONTACT_OPTIONS = CONTACT_METHODS.map(m => ({ value: m.id, label: m.label }));
const INTEREST_OPTIONS = PARTNERSHIP_INTERESTS.map(i => ({ value: i.id, label: i.title }));
const CONTACT_ICON: Record<ContactMethod, typeof Send> = { telegram: Send, whatsapp: Phone, email: AtSign, linkedin: Linkedin, discord: MessageCircle, other: Globe2 };
type Fields = { company: string; workEmail: string; contactMethod: ContactMethod; contactDetail: string; fullName: string; jobTitle: string; website: string; interest: PartnershipInterest | ""; message: string };
const EMPTY: Fields = { company: "", workEmail: "", contactMethod: "telegram", contactDetail: "", fullName: "", jobTitle: "", website: "", interest: "", message: "" };
type Submit = { kind: "idle" } | { kind: "sending" } | { kind: "done"; id: string; duplicate: boolean } | { kind: "error"; message: string };

export type ModalSource = "partners_hero" | "partners_card" | "partners_cta" | "nav" | "direct";

export default function PartnershipModal({ open, onClose, initialInterest, source }: { open: boolean; onClose: () => void; initialInterest?: PartnershipInterest; source: ModalSource }) {
  const ids = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const discardRef = useRef<HTMLButtonElement>(null);
  const sending = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const openedAt = useRef(0);
  const [f, setF] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submit, setSubmit] = useState<Submit>({ kind: "idle" });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = submit.kind !== "done" && (Object.keys(f) as (keyof Fields)[]).some(k => k !== "contactMethod" && k !== "interest" && f[k] !== "");

  // Opening: remember focus, lock scroll, apply the preselected interest, focus the first field.
  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    openedAt.current = performance.now();
    setConfirmDiscard(false);
    if (initialInterest) setF(v => (v.interest ? v : { ...v, interest: initialInterest }));
    trackEvent("partnership_modal_open", { source, interest: initialInterest ?? "none" });
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.showModal();
    // Only the initial placement: if focus already moved inside the dialog (an
    // error field, the success heading), leave it there.
    const t = window.setTimeout(() => {
      const d = dialogRef.current;
      if (!d || (document.activeElement && d.contains(document.activeElement) && document.activeElement !== d)) return;
      (d.querySelector<HTMLElement>("form input:not([tabindex='-1'])") ?? d.querySelector<HTMLElement>("button"))?.focus();
    }, 30);
    return () => { window.clearTimeout(t); document.body.style.overflow = prev; returnFocus.current?.focus?.(); };
  }, [open, initialInterest, source]);

  const requestClose = useCallback(() => {
    if (submit.kind === "sending") return;
    if (dirty) { setConfirmDiscard(true); return; }
    setF(EMPTY); setErrors({}); setSubmit({ kind: "idle" });
    setConfirmDiscard(false);
    onClose();
  }, [dirty, submit.kind, onClose]);

  // The native top layer makes the background inert and traps focus, including
  // assistive technology and programmatic focus. Discard always needs a choice.
  useEffect(() => {
    if (confirmDiscard) discardRef.current?.focus();
    if (submit.kind === "done") dialogRef.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [confirmDiscard, submit.kind]);

  if (!open) return null;

  const set = <K extends keyof Fields>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(k, e.target.value as Fields[K]);
  // Picking the option that is already selected changes nothing — in
  // particular it must not clear the contact detail the visitor typed.
  const setValue = <K extends keyof Fields>(k: K, value: Fields[K]) => {
    if (f[k] === value) return;
    setF(v => ({ ...v, [k]: value }));
    setConfirmDiscard(false);
    if (errors[k]) setErrors(({ [k]: _drop, ...rest }) => rest);
    if (k === "contactMethod") {
      setF(v => ({ ...v, contactDetail: "" }));
      setErrors(({ contactDetail: _drop, ...rest }) => rest);
    }
    if (k === "interest" && value) trackEvent("partnership_interest_selected", { interest: String(value) });
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending.current) return;
    const honeypot = (e.currentTarget.elements.namedItem("companySite") as HTMLInputElement | null)?.value ?? "";
    const payload = { ...f, interest: f.interest || undefined, source, companySite: honeypot, elapsedMs: Math.round(performance.now() - openedAt.current) };
    const local = validateInquiry(payload);
    if (!local.ok) {
      setErrors(local.errors);
      focusFirstError(local.errors);
      return;
    }
    setErrors({});
    sending.current = true;
    setSubmit({ kind: "sending" });
    trackEvent("partnership_form_submit", { interest: f.interest || "none" });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch("/api/partnerships/inquiries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; duplicate?: boolean; error?: string; fields?: Record<string, string> };
      if (res.ok && body.ok && body.id) {
        setSubmit({ kind: "done", id: body.id, duplicate: Boolean(body.duplicate) });
        trackEvent("partnership_form_success", { interest: f.interest || "none", duplicate: Boolean(body.duplicate) });
        return;
      }
      if (body.fields) { setErrors(body.fields); focusFirstError(body.fields); }
      setSubmit({ kind: "error", message: res.status === 429 ? "Too many submissions from your network. Please wait a few minutes and try again." : body.error ?? "Something went wrong. Your details are still here — please try again." });
      trackEvent("partnership_form_error", { reason: String(res.status) });
    } catch {
      setSubmit({ kind: "error", message: "We could not confirm receipt. Your details are still here; retrying safely checks for an existing inquiry." });
      trackEvent("partnership_form_error", { reason: "network" });
    } finally {
      window.clearTimeout(timeout);
      sending.current = false;
    }
  }

  function focusFirstError(errs: Record<string, string>) {
    const order: (keyof Fields)[] = ["company", "workEmail", "contactMethod", "contactDetail", "fullName", "jobTitle", "website", "interest", "message"];
    const k = order.find(x => errs[x]);
    if (k) window.setTimeout(() => document.getElementById(`${ids}-${k}`)?.focus(), 0);
  }

  const method = CONTACT_METHODS.find(m => m.id === f.contactMethod)!;
  const MethodIcon = CONTACT_ICON[f.contactMethod];
  const fieldProps = (k: keyof Fields) => ({
    id: `${ids}-${k}`, name: k, value: f[k], onChange: set(k), disabled: submit.kind === "sending", "aria-invalid": errors[k] ? true : undefined,
    "aria-describedby": errors[k] ? `${ids}-${k}-err` : undefined, className: "fp-input",
  });
  const err = (k: string) => errors[k] ? <p id={`${ids}-${k}-err`} className="fp-error mt-1.5">{errors[k]}</p> : null;
  const req = <span className="text-[#ff6b7a]" aria-hidden="true"> *</span>;

  return (
    <dialog
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        aria-describedby={`${ids}-desc`}
        className="fp-modal-root fp-modal-shell"
        onCancel={e => { e.preventDefault(); requestClose(); }}
        onClick={e => { if (e.target === e.currentTarget) requestClose(); }}
      >
      <div className="fp-dialog relative grid w-full overflow-hidden lg:grid-cols-[38fr_62fr]" style={{ maxHeight: "calc(100dvh - 32px)" }}>
        {/* ── Brand panel ─────────────────────────────────────────────── */}
        <aside className="fp-brand-panel relative m-2 hidden flex-col overflow-hidden rounded-[20px] p-8 lg:flex">
          <div className="fp-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
          <div className="relative flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.png" alt="" width={44} height={44} className="h-11 w-11 rounded-xl" />
            <span className="text-[20px] font-semibold tracking-tight">FurlPay Wallet</span>
          </div>
          <p className="relative mt-12 text-[52px] font-bold leading-[1.02] tracking-[-0.035em]">
            Build with<br /><span className="text-[var(--fp-primary-bright)]">FurlPay</span>
          </p>
          <p className="fp-pill relative mt-6 self-start px-4 py-2 text-[12px] font-semibold text-[var(--fp-text)]">STABLECOIN PAYMENTS &amp; WEB3 INFRASTRUCTURE</p>
          <div className="relative -mx-16 -mb-24 mt-4 flex-1" style={{ minHeight: 220 }}>
            <div className="absolute inset-x-0 top-0 mx-auto w-[125%] max-w-[560px] -translate-x-[10%]">
              <PaymentsGlobe center={[22, 60]} interactive={false} minViewportWidth={1024} label="Globe with illustrative routes between world cities" />
            </div>
          </div>
          {/* FurlPay's own statement, not a customer testimonial. */}
          <div className="fp-card relative mt-auto p-6">
            <p className="text-[17px] leading-relaxed text-[var(--fp-text)]">We build with partners to make stablecoin payments more connected, programmable and global.</p>
            <div className="mt-5 flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon.png" alt="" width={40} height={40} className="h-10 w-10 rounded-full" />
              <div>
                <p className="text-[14px] font-semibold">FurlPay Partner Network</p>
                <p className="text-[12.5px] text-[var(--fp-text-2)]">Payments • Web3 • Global Access</p>
              </div>
            </div>
          </div>
        </aside>

        {/* ── Form panel ──────────────────────────────────────────────── */}
        <section className="relative flex min-h-0 flex-col overflow-y-auto px-5 pb-5 pt-6 sm:px-10 sm:pt-10">
          <button type="button" onClick={requestClose} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full text-[var(--fp-text-2)] hover:bg-white/5 hover:text-white" aria-label="Close partnership inquiry">
            <X size={20} />
          </button>

          {submit.kind === "done" ? (
            <div className="flex flex-1 flex-col items-start justify-center py-10" role="status" aria-live="polite">
              <CheckCircle2 className="text-[var(--fp-primary-bright)]" size={44} aria-hidden="true" />
              <h2 id={`${ids}-title`} tabIndex={-1} className="mt-5 text-[32px] font-bold tracking-tight">{submit.duplicate ? "We already have your inquiry" : "Inquiry received"}</h2>
              <p id={`${ids}-desc`} className="mt-3 max-w-lg text-[16px] leading-relaxed text-[var(--fp-text-2)]">
                {submit.duplicate
                  ? "You sent an inquiry about this partnership type today, so we kept the first one rather than creating a duplicate."
                  : "Your inquiry is saved for our partnerships team to review. Your preferred contact method is included."}
              </p>
              <p className="mt-4 text-[13px] text-[var(--fp-text-3)]">Reference: <span className="font-mono">{submit.id.slice(0, 8)}</span></p>
              <button type="button" onClick={requestClose} className="fp-btn fp-btn-ghost mt-8 px-5 py-3 text-[15px]">Close</button>
            </div>
          ) : (
            <form noValidate onSubmit={onSubmit} className="flex flex-col">
              {/* Small screens: the brand panel collapses to this line; the globe is desktop-only here. */}
              <div className="mb-4 flex items-center gap-2.5 lg:hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icon.png" alt="" width={32} height={32} className="h-8 w-8 rounded-lg" />
                <span className="text-[15px] font-semibold">Build with <span className="text-[var(--fp-primary-bright)]">FurlPay</span></span>
              </div>
              <h2 id={`${ids}-title`} className="pr-10 text-[30px] font-bold tracking-[-0.02em] sm:text-[36px]">Let&apos;s build together</h2>
              <p id={`${ids}-desc`} className="mt-1 text-[16px] text-[var(--fp-text-2)]">Tell us about your organization and partnership goals.</p>

              <div className="mt-6 grid gap-x-5 gap-y-4 sm:grid-cols-2">
                <div className="fp-field sm:col-span-2">
                  <label htmlFor={`${ids}-company`}>Company / Project{req}</label>
                  <input {...fieldProps("company")} className="fp-input mt-2" placeholder="Project or company name" autoComplete="organization" maxLength={120} required />
                  {err("company")}
                </div>
                <div className="fp-field">
                  <label htmlFor={`${ids}-workEmail`}>Work email{req}</label>
                  <input {...fieldProps("workEmail")} className="fp-input mt-2" type="email" placeholder="Enter your work email" autoComplete="email" maxLength={254} required />
                  {err("workEmail")}
                </div>
                <div className="fp-field">
                  <span className="block text-[14px] font-medium" id={`${ids}-contact-label`}>Contact method{req}</span>
                  <div className="mt-2 grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-2">
                    <PartnershipSelect id={`${ids}-contactMethod`} labelId={`${ids}-contact-label`} value={f.contactMethod}
                      options={CONTACT_OPTIONS} onValueChange={v => setValue("contactMethod", v as ContactMethod)}
                      icon={<MethodIcon size={16} />} required disabled={submit.kind === "sending"}
                      invalid={!!errors.contactMethod} describedBy={errors.contactMethod ? `${ids}-contactMethod-err` : undefined} />
                    <div>
                      <label htmlFor={`${ids}-contactDetail`} className="fp-sr-only">{method.label} contact detail</label>
                      <input {...fieldProps("contactDetail")} className="fp-input" placeholder={method.placeholder} title={method.placeholder} required={f.contactMethod !== "email"}
                        type={f.contactMethod === "email" ? "email" : f.contactMethod === "whatsapp" ? "tel" : f.contactMethod === "linkedin" ? "url" : "text"} maxLength={300} />
                    </div>
                  </div>
                  {err("contactMethod")}{err("contactDetail")}
                </div>
                <div className="fp-field">
                  <label htmlFor={`${ids}-fullName`}>Full name</label>
                  <input {...fieldProps("fullName")} className="fp-input mt-2" placeholder="Enter your full name" autoComplete="name" maxLength={120} />
                  {err("fullName")}
                </div>
                <div className="fp-field">
                  <label htmlFor={`${ids}-jobTitle`}>Job title</label>
                  <input {...fieldProps("jobTitle")} className="fp-input mt-2" placeholder="Enter your job title" autoComplete="organization-title" maxLength={120} />
                  {err("jobTitle")}
                </div>
                <div className="fp-field sm:col-span-2">
                  <label htmlFor={`${ids}-website`}>Website</label>
                  <input {...fieldProps("website")} className="fp-input mt-2" type="url" inputMode="url" placeholder="https://yourcompany.com" autoComplete="url" maxLength={300} />
                  {err("website")}
                </div>
                <div className="fp-field sm:col-span-2">
                  <label id={`${ids}-interest-label`} htmlFor={`${ids}-interest`}>Partnership interest{req}</label>
                  <div className="mt-2">
                    <PartnershipSelect id={`${ids}-interest`} labelId={`${ids}-interest-label`} value={f.interest}
                      options={INTEREST_OPTIONS} onValueChange={v => setValue("interest", v as PartnershipInterest)}
                      placeholder="Select a partnership type" required disabled={submit.kind === "sending"}
                      invalid={!!errors.interest} describedBy={errors.interest ? `${ids}-interest-err` : undefined} />
                  </div>
                  {err("interest")}
                </div>
                <div className="fp-field sm:col-span-2">
                  <label htmlFor={`${ids}-message`}>Additional information</label>
                  <textarea {...fieldProps("message")} className="fp-input mt-2 min-h-[96px] resize-y" rows={3} maxLength={4000}
                    placeholder="Tell us more about your organization, partnership goals, relevant links, or any questions you have." />
                  <p className="mt-1 text-right text-[11.5px] text-[var(--fp-text-3)]" aria-live="off">{f.message.length}/4000</p>
                  {err("message")}
                </div>
              </div>

              {/* Hidden from people (and from assistive tech); bots fill it in. */}
              <div className="fp-sr-only" aria-hidden="true">
                <label htmlFor={`${ids}-companySite`}>Leave this empty</label>
                <input id={`${ids}-companySite`} name="companySite" tabIndex={-1} autoComplete="off" defaultValue="" />
              </div>

              <div aria-live="assertive" className="min-h-0">
                {submit.kind === "error" && <p className="fp-error mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-[14px]" role="alert">{submit.message}</p>}
                {confirmDiscard && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--fp-border-active)] bg-[rgba(0,219,160,0.06)] px-4 py-3 text-[14px]" role="alert">
                    <span>Close and discard what you have entered?</span>
                    <button ref={discardRef} type="button" className="fp-btn fp-btn-ghost px-3 py-1.5 text-[13px]" onClick={() => { setConfirmDiscard(false); dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus(); }}>Keep editing</button>
                    <button type="button" className="fp-btn px-3 py-1.5 text-[13px] text-red-300 hover:bg-red-500/10" onClick={() => { setF(EMPTY); setErrors({}); setSubmit({ kind: "idle" }); setConfirmDiscard(false); onClose(); }}>Discard</button>
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-col-reverse items-stretch gap-4 border-t border-white/5 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[12px] leading-relaxed text-[var(--fp-text-2)]">We use these details to review and respond to your inquiry. <Link href="/legal/privacy" className="underline underline-offset-4">Privacy policy</Link></p>
                <button type="submit" className="fp-btn fp-btn-primary shrink-0 px-6 py-3.5 text-[16px]" disabled={submit.kind === "sending"} aria-busy={submit.kind === "sending"}>
                  {submit.kind === "sending" ? "Submitting…" : <>Submit partnership inquiry <ArrowRight size={18} aria-hidden="true" /></>}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </dialog>
  );
}
