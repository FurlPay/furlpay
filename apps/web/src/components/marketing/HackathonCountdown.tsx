"use client";

import { useEffect, useState } from "react";

// Counts down to the current season's submission deadline. Rolling by design —
// past the deadline it flips to an "open, rolling review" state rather than
// dead-ending. Deadline is overridable via NEXT_PUBLIC_HACKATHON_DEADLINE.
const DEADLINE_ISO = process.env.NEXT_PUBLIC_HACKATHON_DEADLINE || "2026-08-31T23:59:59Z";

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    mins: Math.floor((s % 3600) / 60),
    secs: s % 60,
  };
}

export default function HackathonCountdown() {
  const deadline = new Date(DEADLINE_ISO).getTime();
  const [now, setNow] = useState<number | null>(null);

  // Start ticking only after mount to avoid hydration mismatch.
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (now === null) {
    // Server + first paint: neutral placeholder (no live numbers yet).
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-5 text-center text-[13px] text-textMuted">
        Loading season timer…
      </div>
    );
  }

  const remaining = deadline - now;
  if (remaining <= 0) {
    return (
      <div className="rounded-2xl border border-neon/25 bg-neon/[0.05] px-6 py-5 text-center">
        <p className="text-[13px] font-semibold text-neon">Submissions are open — rolling review</p>
        <p className="mt-1 text-[12px] text-textMuted">Submit any time; we review new builds continuously.</p>
      </div>
    );
  }

  const { days, hours, mins, secs } = parts(remaining);
  const cells: [string, number][] = [["Days", days], ["Hrs", hours], ["Min", mins], ["Sec", secs]];

  return (
    <div>
      <p className="mb-2 text-center text-[12px] font-semibold uppercase tracking-[0.18em] text-textSecondary">
        Season 1 submissions close in
      </p>
      <div className="flex justify-center gap-3">
        {cells.map(([label, val]) => (
          <div key={label} className="min-w-[64px] rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-center">
            <div className="text-[26px] font-extrabold tabular-nums tracking-tight text-white">
              {String(val).padStart(2, "0")}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-textMuted">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
