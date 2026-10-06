"use client";

// The report's "Download PDF" action: a small dialog that asks for one
// business email, records it, then downloads the PDF.
//
// A soft gate by design (founder decision, 2026-10-06): the PDF itself stays a
// public file, linked from the chapters and the footer and indexed by search.
// The form never blocks the reader. If recording the email fails (server
// error, rate limit, network), the PDF downloads anyway; only an address we
// refuse (consumer or malformed) keeps the dialog open.

import Image from "next/image";
import { useCallback, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDownToLine, Check, Loader2, X } from "lucide-react";
import { classifyEmail } from "@/lib/leads/types";
import "./reportDownload.css";

type Phase = "form" | "submitting" | "done";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MESSAGES = {
  invalid: "Please enter a valid email address.",
  business: "Please enter your business or work email.",
};

export default function ReportDownload({
  slug,
  reportTitle,
  fileHref,
  fileName,
  coverSrc,
  className,
  children,
}: {
  slug: string;
  reportTitle: string;
  /** The PDF the dialog downloads (a public file). */
  fileHref: string;
  fileName: string;
  coverSrc: string;
  /** Classes for the trigger button, so it matches the page's buttons. */
  className: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const [phase, setPhase] = useState<Phase>("form");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const ids = useId();
  const titleId = `${ids}-title`;
  const descId = `${ids}-desc`;
  const errorId = `${ids}-error`;

  const startDownload = useCallback(() => {
    const a = document.createElement("a");
    a.href = fileHref;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [fileHref, fileName]);

  const open = () => {
    setPhase("form");
    setError(null);
    dialogRef.current?.showModal();
    // showModal focuses the first focusable element (the close button); the
    // field is what the reader came to fill in.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const close = () => {
    if (phase === "submitting") return;
    dialogRef.current?.close();
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (phase === "submitting") return;
    const value = email.trim();
    const problem = !EMAIL_SHAPE.test(value)
      ? MESSAGES.invalid
      : classifyEmail(value) === "consumer"
        ? MESSAGES.business
        : null;
    if (problem) {
      // Back to the field, which keeps what was typed, so it can be corrected.
      setError(problem);
      inputRef.current?.focus();
      return;
    }

    setError(null);
    setPhase("submitting");
    let res: Response | null = null;
    try {
      res = await fetch(`/api/reports/${encodeURIComponent(slug)}/download`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value, consent: true }),
      });
    } catch {
      res = null; // network failure: never block the report on our side
    }

    // Only an address the server refuses keeps the dialog on the form.
    if (res && (res.status === 400 || res.status === 422)) {
      const body = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
      setPhase("form");
      setError(res.status === 422 && body?.detail ? body.detail : MESSAGES.invalid);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }

    setPhase("done");
    startDownload();
    requestAnimationFrame(() => doneRef.current?.focus());
  };

  return (
    <>
      <button ref={triggerRef} type="button" onClick={open} className={className} aria-haspopup="dialog">
        {children}
      </button>

      <dialog
        ref={dialogRef}
        className="report-dl"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onCancel={(e) => {
          // Escape closes, except while the request is in flight.
          if (phase === "submitting") e.preventDefault();
        }}
        onClose={() => {
          setPhase("form");
          triggerRef.current?.focus();
        }}
        onMouseDown={(e) => {
          // A press on the backdrop lands on the <dialog> itself.
          if (e.target === dialogRef.current) close();
        }}
      >
        <div className="relative p-6 sm:p-8">
          <button type="button" onClick={close} className="close absolute right-4 top-4" aria-label="Close download dialog">
            <X aria-hidden className="h-5 w-5" />
          </button>

          {phase === "done" ? (
            <div className="swap flex flex-col items-center py-4 text-center" role="status">
              <span className="done-mark">
                <Check aria-hidden className="h-6 w-6" strokeWidth={2.25} />
              </span>
              <h2 ref={doneRef} id={titleId} tabIndex={-1} className="mt-5 text-[24px] font-medium tracking-[-0.02em] outline-none">
                Your report is ready
              </h2>
              <p id={descId} className="mt-2 text-[15px] leading-relaxed text-[var(--muted)]">
                Your download should start automatically.
              </p>
              <div className="mt-7 w-full space-y-2">
                <button type="button" onClick={startDownload} className="primary">
                  Download again
                  <ArrowDownToLine aria-hidden className="h-[18px] w-[18px]" />
                </button>
                <button type="button" onClick={close} className="quiet w-full">
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form noValidate onSubmit={onSubmit} className="swap">
              <div className="flex items-center gap-4 pr-10">
                <Image
                  src={coverSrc}
                  alt=""
                  width={1024}
                  height={1536}
                  sizes="56px"
                  className="h-auto w-14 shrink-0 drop-shadow-[0_8px_16px_rgba(0,0,0,0.5)]"
                />
                <div>
                  <p className="eyebrow">Annual report · PDF</p>
                  <p className="mt-2 text-[14px] leading-snug text-[var(--foreground)]">{reportTitle}</p>
                </div>
              </div>

              <h2 id={titleId} className="mt-6 text-[26px] font-medium leading-tight tracking-[-0.02em]">
                Download the report
              </h2>
              <p id={descId} className="mt-2 text-[15px] leading-relaxed text-[var(--muted)]">
                Enter your business email to unlock the PDF instantly.
              </p>

              <label htmlFor={`${ids}-email`} className="mt-6 block text-[14px] font-medium">
                Business email
              </label>
              <input
                ref={inputRef}
                id={`${ids}-email`}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                placeholder="name@company.com"
                value={email}
                readOnly={phase === "submitting"}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className="field mt-2"
              />
              <p id={errorId} aria-live="polite" className="min-h-[22px] pt-2 text-[13px] leading-snug text-[var(--notice)]">
                {error}
              </p>

              <button type="submit" disabled={phase === "submitting"} aria-busy={phase === "submitting"} className="primary mt-2">
                {phase === "submitting" ? (
                  <>
                    <Loader2 aria-hidden className="h-[18px] w-[18px] animate-spin" />
                    Preparing report…
                  </>
                ) : (
                  <>
                    Download Report
                    <ArrowDownToLine aria-hidden className="h-[18px] w-[18px]" />
                  </>
                )}
              </button>

              <p className="mt-4 text-center text-[13px] text-[var(--muted)]">Free access · No account required</p>
              <p className="mt-4 text-center text-[12px] leading-relaxed text-[#6f7b75]">
                By submitting, you agree that FurlPay may use your business email to send you this
                report. See our{" "}
                <a href="/legal/privacy" className="underline underline-offset-2 hover:text-[var(--foreground)]">
                  Privacy Policy
                </a>
                .
              </p>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
