"use client";

import { Eye } from "lucide-react";
import { useBalanceVisibility } from "./BalanceVisibility";

// ---------------------------------------------------------------------------
// The "Blur balances" switch, as it appears inside the account menu.
//
// ── IT IS A switch, NOT A menuitem ─────────────────────────────────────────
//
// Every other row in that menu navigates somewhere and closes the panel. This
// one changes a setting and must NOT close, so a person can see the effect and
// change their mind. Marking it `role="menuitemcheckbox"` with `aria-checked`
// is what tells a screen-reader user the same thing the sliding knob tells a
// sighted one — that this row has an on/off state rather than a destination.
//
// The whole row is the hit target. A 36x20 switch is a small tap target on a
// phone, and the label beside it is dead space that the user will aim at
// anyway.
// ---------------------------------------------------------------------------

export default function BalanceVisibilityToggle({ className = "" }: { className?: string }) {
  const { hidden, toggle } = useBalanceVisibility();

  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={hidden}
      onClick={(e) => {
        // The menu closes on any click that reaches the document; this one is
        // a setting change, so it stops there.
        e.stopPropagation();
        toggle();
      }}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-textSecondary transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:bg-white/[0.06] focus-visible:text-white focus-visible:outline-none ${className}`}
    >
      <Eye className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1 text-left">Blur balances</span>

      {/* The switch. Presentational: the button above owns the semantics, so
          this must not be another focusable control. */}
      <span
        aria-hidden
        className={`relative inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full transition-colors duration-200 ${
          hidden ? "bg-neon" : "bg-white/[0.16]"
        }`}
      >
        <span
          className={`absolute h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
            hidden ? "translate-x-[18px]" : "translate-x-[2px]"
          }`}
        />
      </span>

      <span className="sr-only">{hidden ? "on" : "off"}</span>
    </button>
  );
}
