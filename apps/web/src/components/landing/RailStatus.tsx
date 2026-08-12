"use client";

/*
 * Live rail status, read from the public `/api/rails` endpoint.
 *
 * This is a real call to this deployment, not a hardcoded list of green dots.
 * `/api/rails` merges the rail registry with the ops control plane's public
 * status (pause state + freshness-bounded health), which means a rail with no
 * production credentials reports NOT CONFIGURED here rather than pretending to
 * be operational — the honest answer is the useful one.
 *
 * If the request fails, the component says so. It never falls back to a
 * cheerful default.
 */

import { useEffect, useState } from "react";

type RailStatusValue =
  | "HEALTHY"
  | "DEGRADED"
  | "INCIDENT"
  | "PAUSED"
  | "NOT_CONFIGURED"
  | "UNKNOWN";

interface Rail {
  rail: string;
  name: string;
  asset: string;
  status?: RailStatusValue;
}

const TONE: Record<RailStatusValue, { dot: string; text: string; label: string }> = {
  HEALTHY: { dot: "bg-gain", text: "text-gain", label: "Operational" },
  DEGRADED: { dot: "bg-amber-400", text: "text-amber-400", label: "Degraded" },
  INCIDENT: { dot: "bg-loss", text: "text-loss", label: "Incident" },
  PAUSED: { dot: "bg-amber-400", text: "text-amber-400", label: "Paused" },
  NOT_CONFIGURED: { dot: "bg-white/25", text: "text-textMuted", label: "Not configured" },
  UNKNOWN: { dot: "bg-white/25", text: "text-textMuted", label: "Unknown" },
};

export default function RailStatus() {
  const [rails, setRails] = useState<Rail[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/rails", {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`http ${res.status}`);
        const data = (await res.json()) as { rails?: Rail[] };
        if (cancelled) return;
        if (!Array.isArray(data.rails)) throw new Error("unexpected payload");
        setRails(data.rails);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <p className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-[13px] text-textMuted">
        Could not reach <code className="font-mono text-[12px]">/api/rails</code> from this browser.
      </p>
    );
  }

  if (!rails) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading rail status">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-[46px] animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.02]" />
        ))}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.08]">
      {rails.map((rail) => {
        const tone = TONE[rail.status ?? "UNKNOWN"] ?? TONE.UNKNOWN;
        return (
          <li key={rail.rail} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block truncate text-[14px] text-white">{rail.name}</span>
              <span className="font-mono text-[11px] text-textMuted">{rail.asset}</span>
            </span>
            <span className={`flex shrink-0 items-center gap-2 text-[12.5px] font-semibold ${tone.text}`}>
              <span aria-hidden className={`h-2 w-2 rounded-full ${tone.dot}`} />
              {tone.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
