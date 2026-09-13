"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// An on-chain address, shown in full and copyable in one click.
//
// SHOWN IN FULL, NEVER TRUNCATED — the same rule as components/marketing/
// BitcoinAddress.tsx, for the same reason: a middle-elided address
// (FYatJq…V3gY1) is where an address-swapping attack hides, and a reader who
// cannot see every character cannot check it against another source. The one
// defence a person has is comparing the string, so the string is on the page.
//
// The copy button exists because hand-typing 44 base58 characters invites a
// transcription error, and an on-chain transfer does not come back.
// ---------------------------------------------------------------------------

export default function CopyField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied (permissions, insecure context, older
      // browser). The value is select-all text either way, so a silent failure
      // leaves the reader no worse off than a page with no button — and
      // claiming it copied when it did not would be worse than saying nothing.
      setCopied(false);
    }
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-textMuted">{label}</p>
        {hint && <p className="text-[11px] text-textMuted">{hint}</p>}
      </div>
      <div className="mt-2 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <code
          className="min-w-0 flex-1 select-all break-all rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-left font-mono text-[12.5px] leading-relaxed text-white"
          aria-label={`${label} ${value}`}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className="btn-outline shrink-0 px-4 py-2.5 text-[13px]"
          // The label changes, so the state is announced rather than only shown.
          aria-live="polite"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
