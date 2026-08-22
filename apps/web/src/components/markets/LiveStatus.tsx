"use client";

import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// "Live · Updated 12s ago".
//
// The age is REAL and means one specific thing: how long ago the server
// assembled this response (`asOf` on the API payload). It is not a market data
// timestamp and does not claim to be — the page refetches on an interval and
// this is the age of what is on screen.
//
// The two states are load-bearing:
//   live=true   at least one asset was priced by a provider in the current
//               cache window, so the figures are current
//   live=false  every price came from the seed fallback — the label says
//               "Delayed", because calling that live is the exact lie this
//               component exists to avoid
//
// With no `asOf` at all (the very first paint, before any response), the chip
// says "Live prices" with no age rather than inventing one.
// ---------------------------------------------------------------------------

export default function LiveStatus({
  live,
  asOf,
  className,
}: {
  live: boolean;
  asOf: string | null;
  className?: string;
}) {
  const [age, setAge] = useState<string | null>(null);

  useEffect(() => {
    if (!asOf) {
      setAge(null);
      return;
    }
    const at = Date.parse(asOf);
    if (!Number.isFinite(at)) {
      setAge(null);
      return;
    }

    // Ticking on the client rather than rendering the age on the server: a
    // server-rendered "3s ago" is wrong the moment it is cached, and the number
    // has to keep counting while the reader looks at it.
    const tick = () => {
      const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
      if (secs < 60) setAge(`${secs}s ago`);
      else if (secs < 3600) setAge(`${Math.round(secs / 60)}m ago`);
      else setAge(`${Math.round(secs / 3600)}h ago`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [asOf]);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${live ? "bg-gain/10 text-gain" : "bg-white/[0.06] text-textMuted"} ${className ?? ""}`}
      // Polite, not assertive: a per-second timestamp must never interrupt a
      // screen reader mid-sentence.
      aria-live="polite"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-gain" : "bg-white/30"}`}
        aria-hidden
      />
      <span>{live ? "LIVE" : "DELAYED"}</span>
      {age && (
        <>
          <span className="text-textMuted" aria-hidden>
            ·
          </span>
          <span className="text-textSecondary font-mono">Updated {age}</span>
        </>
      )}
    </span>
  );
}
