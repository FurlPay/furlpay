"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// The address, shown in full and copyable in one click.
//
// SHOWN IN FULL, NEVER TRUNCATED. A middle-elided address (bc1q0qa…amham) is
// the standard UI shortcut and it is exactly wrong here: the elided middle is
// where an address-swapping attack hides, and a reader who cannot see the whole
// string cannot check it. The one thing a person can do to protect themselves
// is compare characters, so the characters have to be on the page.
//
// The copy button exists for the same reason. Hand-typing 42 characters invites
// a transcription error, and on-chain transfers do not come back.
// ---------------------------------------------------------------------------

export default function BitcoinAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      // Long enough to read, short enough that the button is ready again if
      // the paste did not land where the person expected.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied (permissions, insecure context, an
      // older browser). The address is selectable text either way, so failing
      // silently here leaves the user no worse off than a page without a
      // button — and pretending it copied would be worse than saying nothing.
      setCopied(false);
    }
  }

  return (
    <div className="mt-5 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      <code
        className="min-w-0 flex-1 select-all break-all rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-left font-mono text-[12.5px] leading-relaxed text-white"
        // Announced as one string rather than letter-by-letter guesswork.
        aria-label={`Bitcoin address ${address}`}
      >
        {address}
      </code>
      <button
        type="button"
        onClick={copy}
        className="btn-outline shrink-0 px-4 py-2.5 text-[14px]"
        // The label changes, so the state is announced rather than only shown.
        aria-live="polite"
      >
        {copied ? "Copied" : "Copy address"}
      </button>
    </div>
  );
}
