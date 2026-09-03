"use client";

// ---------------------------------------------------------------------------
// The row of numbers under the profile name.
//
// ── WHY THERE ARE NO FOLLOWER COUNTS HERE BY DEFAULT ───────────────────────
//
// The design this was drawn from puts "Following / Followers" front and centre,
// and this app has no social graph for an ordinary account: `Profile` carries a
// name, an email, a tier, a region and a KYC status, and nothing that counts
// people. The creator programme has a real follow graph (lib/creator.ts), but
// it is scoped to creators and is not exposed on any route this page can call.
//
// So `followers` and `following` are OPTIONAL, and a count that is not supplied
// is not rendered. Printing "0 followers" for every account would be inventing
// a number: it reads as a fact about the person rather than as the absence of a
// feature, and it is the kind of placeholder that survives to production
// because it looks finished.
//
// Everything actually shown below is a real field on the account.
// ---------------------------------------------------------------------------

export interface ProfileStat {
  label: string;
  value: string;
  /** Rendered smaller and muted beside the value, e.g. a unit or a qualifier. */
  hint?: string;
}

/** A count formatted the way a social product formats one: 1,204 → 1.2K. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}K`;
  }
  const m = n / 1_000_000;
  return `${m >= 100 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * How long the account has existed, in the coarsest honest unit.
 *
 * "3 months" rather than "94 days": nobody reads an account age to the day, and
 * a number that changes every morning looks like a bug.
 */
export function accountAge(since: string | null | undefined, now = new Date()): string | null {
  if (!since) return null;
  const t = Date.parse(since);
  if (!Number.isFinite(t)) return null;
  const then = new Date(t);
  const days = Math.floor((now.getTime() - t) / 86_400_000);
  if (days < 0) return null;
  if (days < 1) return "Today";
  if (days < 31) return `${days} day${days === 1 ? "" : "s"}`;

  // CALENDAR months, not days/30.44. Averaged-day arithmetic drifts: two exact
  // years is 730 days, 730/365.25 floors to 1, and an account opened on this
  // date two years ago reads "1y 11m". Counting month boundaries and then
  // rolling back one if the day-of-month has not come round yet is exact.
  let months =
    (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
  if (now.getDate() < then.getDate()) months -= 1;
  if (months < 1) return `${days} day${days === 1 ? "" : "s"}`;
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;

  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem === 0 ? `${years} year${years === 1 ? "" : "s"}` : `${years}y ${rem}m`;
}

export default function ProfileStats({
  stats,
  followers,
  following,
  className = "",
}: {
  stats: ProfileStat[];
  /** Only rendered when a real count is supplied — see the header. */
  followers?: number;
  following?: number;
  className?: string;
}) {
  const social: ProfileStat[] = [];
  if (typeof following === "number") social.push({ label: "Following", value: formatCount(following) });
  if (typeof followers === "number") social.push({ label: "Followers", value: formatCount(followers) });

  const all = [...social, ...stats];
  if (all.length === 0) return null;

  return (
    <dl className={`flex flex-wrap items-baseline gap-x-6 gap-y-2 ${className}`}>
      {all.map((s) => (
        <div key={s.label} className="flex items-baseline gap-1.5">
          <dd
            className="text-[15px] font-semibold text-white"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {s.value}
          </dd>
          <dt className="text-[12.5px] text-textSecondary">{s.label}</dt>
          {s.hint && <span className="text-[11.5px] text-textMuted">{s.hint}</span>}
        </div>
      ))}
    </dl>
  );
}
