"use client";

import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// The account page's building blocks.
//
// One set of primitives rather than bespoke markup per section, so the twelve
// rows on this page share one border colour, one row height and one focus ring.
// The old /profile page inlined all three and drifted: three different row
// paddings and two different toggle sizes on one screen.
//
// The visual language is /markets': a hairline `white/[0.06]` border, the 18px
// `card` radius, `textSecondary` for labels and white for values. No nested
// cards — a section is a heading plus one bordered block of divided rows, which
// is what the rest of the app already does.
// ---------------------------------------------------------------------------

/** A titled block of rows. `action` sits on the heading line, right-aligned. */
export function Section({
  title,
  description,
  action,
  children,
  id,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="flex items-end justify-between gap-4 px-1">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-textSecondary">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-[12.5px] leading-relaxed text-textMuted">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="mt-2.5 divide-y divide-white/[0.06] overflow-hidden rounded-card border border-white/[0.06] bg-white/[0.02]">
        {children}
      </div>
    </section>
  );
}

/**
 * A label/value row. `hint` goes under the label for the explanatory line the
 * denser rows need (a wallet address, a session's last-seen time).
 */
export function Row({
  label,
  hint,
  children,
  align = "center",
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  /** `start` when the right-hand control is taller than one line. */
  align?: "center" | "start";
}) {
  return (
    <div
      className={`flex flex-wrap gap-x-4 gap-y-2 px-4 py-3.5 sm:flex-nowrap ${
        align === "center" ? "items-center" : "items-start"
      }`}
    >
      {/* The label takes the remaining space but never less than 14rem on sm+.
          The content column may SHRINK and WRAP. It used to be `shrink-0`, so a
          wide control (the picture uploader with its requirements line) sized
          the column to that line's full width and crushed the label into a
          sliver that wrapped every few words. */}
      <div className="min-w-0 flex-1 basis-full sm:min-w-[14rem] sm:basis-0">
        <div className="text-[13.5px] font-medium text-white">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-relaxed text-textMuted">{hint}</div>}
      </div>
      {children && (
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:justify-end">{children}</div>
      )}
    </div>
  );
}

/** Status word — verified / enabled / pending. Never used for an action. */
export function StatusPill({
  tone,
  children,
}: {
  /** brand = the FurlPay emerald (plan / tier). accent is the legacy red,
   *  nearly identical to loss, so it reads as an error and is not used for
   *  neutral states such as a plan name or a pending check. */
  tone: "gain" | "loss" | "accent" | "brand" | "muted";
  children: ReactNode;
}) {
  const tones = {
    gain: "bg-gain/[0.12] text-gain",
    loss: "bg-loss/[0.12] text-loss",
    accent: "bg-accent/[0.12] text-accent",
    brand: "bg-neon/[0.12] text-neon",
    muted: "bg-white/[0.06] text-textSecondary",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * A real checkbox styled as a switch.
 *
 * `role="switch"` on a native input, not a div with an onClick: the previous
 * toggle was a <button> with no pressed state, so a screen reader announced
 * "Login alerts, button" and never said whether it was on.
 */
export function Toggle({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center gap-4 px-4 py-3.5 ${
        disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-white">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-relaxed text-textMuted">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
          checked ? "bg-accent" : "bg-white/[0.16]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </span>
    </label>
  );
}

/** A labelled <select> for the preference rows. */
export function SelectRow({
  label,
  hint,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <Row label={label} hint={hint}>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-[132px] rounded-lg border border-white/[0.12] bg-black/40 px-3 py-2 text-[13px] font-medium text-white outline-none transition-colors hover:border-white/25 focus-visible:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-55"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#141416]">
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

/** The page's one button vocabulary. */
export function ActionButton({
  children,
  onClick,
  variant = "secondary",
  disabled = false,
  type = "button",
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  ariaLabel?: string;
}) {
  const variants = {
    primary:
      "bg-accent text-white hover:opacity-90 focus-visible:outline-accent disabled:opacity-40",
    secondary:
      "border border-white/[0.14] text-white hover:border-white/30 hover:bg-white/[0.04] focus-visible:outline-white/40 disabled:opacity-45",
    danger:
      "border border-loss/40 text-loss hover:bg-loss/[0.1] focus-visible:outline-loss disabled:opacity-45",
  } as const;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`tap rounded-lg px-3.5 py-2 text-[12.5px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed ${variants[variant]}`}
    >
      {children}
    </button>
  );
}

/**
 * The banner for a capability whose UI is built but whose backend is not wired
 * on this deployment.
 *
 * It exists so those rows cannot be mistaken for working ones. The alternative
 * — rendering a button that silently does nothing — is the failure mode this
 * codebase's own rule against simulated success is written to prevent.
 */
export function NotWiredNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 px-4 py-3 text-[12px] leading-relaxed text-textMuted">
      <span aria-hidden className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
      <span>{children}</span>
    </p>
  );
}

/** Row-shaped shimmer for the loading pass. */
export function RowSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="h-3.5 w-32 animate-pulse rounded bg-white/[0.06]" />
            <div className="mt-2 h-3 w-48 animate-pulse rounded bg-white/[0.04]" />
          </div>
          <div className="h-6 w-16 shrink-0 animate-pulse rounded-full bg-white/[0.05]" />
        </div>
      ))}
    </>
  );
}

/** Nothing to show yet — a real state, not an empty container. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-[12.5px] text-textMuted">{children}</p>;
}

/**
 * Inline result of the last action in a section.
 *
 * Per-section rather than one global toast: these actions are independent, and
 * a toast that floats away takes the error with it — the user is left knowing
 * something failed but not which control. `role="status"` for success and
 * `role="alert"` for failure so a screen reader interrupts only for the latter.
 */
export function Feedback({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: ReactNode;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`flex gap-2 px-4 py-3 text-[12.5px] leading-relaxed ${
        tone === "error" ? "text-loss" : "text-gain"
      }`}
    >
      <span aria-hidden>{tone === "error" ? "✕" : "✓"}</span>
      <span>{children}</span>
    </p>
  );
}
