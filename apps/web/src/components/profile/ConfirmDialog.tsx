"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

// ---------------------------------------------------------------------------
// The one confirmation surface for destructive and security-sensitive account
// actions — revoking a session, disabling 2FA, disconnecting a wallet.
//
// Deliberately NOT window.confirm(). The native dialog cannot be styled, cannot
// carry the consequence text these actions need, and on iOS Safari it blocks
// the whole tab. More importantly it returns a boolean synchronously, which
// pushes every caller into "confirm then fire" — and the actions here have to
// report their own failure, so the dialog has to stay on screen while the
// request is in flight.
//
// Accessibility is the reason this is a component rather than a div per caller:
//
//   * role="dialog" + aria-modal, labelled by its own heading and described by
//     its body, so a screen reader announces what is about to happen rather
//     than reading the page behind it.
//   * Focus moves into the dialog on open and RETURNS to the trigger on close.
//     Losing focus to <body> is the single most common modal bug and it strands
//     keyboard users at the top of the document.
//   * Tab is trapped inside the panel. Without it, tabbing past the last button
//     walks into the page underneath, which is still rendered.
//   * Escape closes, unless a request is in flight — cancelling a dialog whose
//     action is already running would leave the user with no report of how it
//     ended.
//
// Rendered through a portal so the page's stacking contexts (the sticky header
// owns z-40, the profile menu z-50) cannot clip it.
// ---------------------------------------------------------------------------

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** The consequence, in plain language. Rendered as the accessible description. */
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button and a warning tone. Use for anything irreversible. */
  destructive?: boolean;
  /** Set while the action runs: buttons disable and Escape stops dismissing. */
  busy?: boolean;
  /** Shown inside the dialog, so a failure does not vanish with the panel. */
  error?: string | null;
  /** Extra controls (a code field, a checkbox) between the description and the buttons. */
  children?: React.ReactNode;
  /** Disables the confirm button — e.g. a required field is still empty. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  error = null,
  children,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  // The element that had focus before the dialog opened, so it can be given
  // focus back on close.
  const returnFocusTo = useRef<HTMLElement | null>(null);

  const cancel = useCallback(() => {
    if (busy) return;
    onCancel();
  }, [busy, onCancel]);

  useEffect(() => {
    if (!open) return;
    returnFocusTo.current = document.activeElement as HTMLElement | null;

    // Focus the first control in the panel. A dialog that opens with focus
    // still on the page behind it is invisible to a screen reader.
    const first = panelRef.current?.querySelector<HTMLElement>(
      "input, select, textarea, button:not([disabled])"
    );
    first?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        cancel();
        return;
      }
      if (e.key !== "Tab") return;

      // Trap: cycle within the panel's focusable controls.
      const items = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          "a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])"
        ) ?? []
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;

      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      const active = document.activeElement;

      if (e.shiftKey && active === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    // The page behind must not scroll under the dialog.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      returnFocusTo.current?.focus?.();
    };
  }, [open, cancel]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      // A click on the backdrop is a cancel, but only on the backdrop itself —
      // not on a click that started inside the panel and drifted out.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="app-pop app-pop-in w-full max-w-[440px] overflow-hidden rounded-t-card sm:rounded-card"
      >
        <div className="px-5 pt-5">
          <h2
            id={titleId}
            className={`text-[16px] font-bold ${destructive ? "text-loss" : "text-white"}`}
          >
            {title}
          </h2>
          <div id={descId} className="mt-2 text-[13px] leading-relaxed text-textSecondary">
            {description}
          </div>
        </div>

        {children && <div className="px-5 pt-4">{children}</div>}

        {error && (
          <p role="alert" className="mx-5 mt-4 rounded-lg bg-loss/10 px-3 py-2 text-[12.5px] text-loss">
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 p-5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="tap rounded-lg border border-white/[0.14] px-4 py-2.5 text-[13px] font-semibold text-textSecondary transition-colors hover:border-white/30 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            className={`tap rounded-lg px-4 py-2.5 text-[13px] font-bold transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40 ${
              destructive
                ? "bg-loss text-white focus-visible:outline-loss"
                : "bg-accent text-white focus-visible:outline-accent"
            }`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
