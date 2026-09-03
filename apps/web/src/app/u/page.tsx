"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ProfileMenu from "@/components/auth/ProfileMenu";
import { useSession } from "@/components/auth/SessionProvider";
import { getProfile, type Profile } from "@/lib/accountApi";
import ProfileHeader from "@/components/user/ProfileHeader";
import type { ProfileStat } from "@/components/user/ProfileStats";
import { deriveHandle, shortAddress } from "@/components/user/handle";

// ---------------------------------------------------------------------------
// /u — the person's own profile, as a profile rather than as a settings form.
//
// ── WHY THIS IS NOT /profile ───────────────────────────────────────────────
//
// /profile already exists and is the ACCOUNT surface: identity, security,
// wallet, verification, preferences, sessions, danger zone. It is a control
// panel. This page is the other half — who someone is, at a glance — and the
// account menu now names them separately ("Your profile" and "Manage account")
// because they were both called Profile and only one of them was.
//
// ── EVERY FIGURE ON THIS PAGE IS A REAL FIELD ──────────────────────────────
//
// The reference design leads with Following and Followers. This app has no
// social graph for an ordinary account — see ProfileStats for the full note —
// so those counts are simply not passed, and ProfileStats renders nothing for
// them rather than a zero that reads as a fact about the person.
//
// What IS shown comes from /api/profile: the display name, the provider photo,
// the tier, the region, the KYC status and the smart-account address. The
// handle is DERIVED from the email local part (see components/user/handle.ts),
// because the account record has no username field yet — so it is a display
// convenience, not a reserved name, and nothing on this page implies it can be
// claimed.
//
// Those helpers live in their own module rather than here because a page may
// only export `default` and the framework's own names; exporting anything else
// fails the production build, and only the build catches it.
// ---------------------------------------------------------------------------

export default function OwnProfilePage() {
  const { status, user } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    getProfile()
      .then(setProfile)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    // Same guard as /profile: a request fired while the session is still
    // settling races the cookie check and 401s on first paint after sign-in.
    if (status === "loading" || status === "idle") return;
    if (status !== "authenticated") return;
    load();
  }, [status, load]);

  const signedOut = status === "anonymous" || status === "expired";

  return (
    <div className="min-h-screen bg-charcoal">
      <header className="app-ambient sticky top-0 z-30 border-b border-white/[0.06]">
        <div className="mx-auto flex h-14 w-full max-w-[1000px] items-center justify-between px-4 sm:px-6">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-[13px] font-medium text-textSecondary transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </Link>
          <ProfileMenu />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1000px] px-0 pb-24 sm:px-6 sm:pt-6">
        {signedOut ? (
          <EmptyState
            title="You are signed out"
            body="Sign in to see your FurlPay profile."
            action={{ href: "/login?next=/u", label: "Sign in" }}
          />
        ) : failed ? (
          <EmptyState
            title="Could not load your profile"
            body="The request failed. Check your connection and try again."
            onRetry={load}
          />
        ) : !profile ? (
          <HeaderSkeleton />
        ) : (
          <>
            <ProfileHeader
              name={profile.name}
              handle={deriveHandle(profile.email)}
              avatarUrl={profile.avatarUrl}
              initials={profile.initials}
              verified={profile.kycStatus === "verified"}
              memberSince={profile.security?.lastLogin ?? null}
              stats={buildStats(profile)}
              copyValue={
                profile.safeAddress
                  ? { label: "Smart account address", value: profile.safeAddress }
                  : null
              }
              editHref="/profile#profile"
            />

            <section className="mt-6 px-4 sm:px-0">
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailCard label="Smart account" value={shortAddress(profile.safeAddress) ?? "—"} mono />
                <DetailCard label="Region" value={profile.region || "—"} />
                <DetailCard
                  label="Verification"
                  value={
                    profile.kycStatus === "verified"
                      ? "Verified"
                      : profile.kycStatus === "pending"
                        ? "In review"
                        : "Not started"
                  }
                  href={profile.kycStatus === "verified" ? undefined : "/profile#verification"}
                />
                <DetailCard label="Plan" value={profile.tier} href="/profile#profile" />
              </div>

              <p className="mt-4 px-1 text-[11.5px] leading-relaxed text-textMuted">
                {user?.email ? `Signed in as ${user.email}. ` : ""}
                Your handle is shown from your email address — reservable usernames are not
                available yet.
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

/** Only fields the account record actually carries. */
function buildStats(p: Profile): ProfileStat[] {
  const out: ProfileStat[] = [{ label: "plan", value: p.tier }];
  if (p.region) out.push({ label: "region", value: p.region });
  return out;
}

function DetailCard({
  label,
  value,
  href,
  mono = false,
}: {
  label: string;
  value: string;
  href?: string;
  mono?: boolean;
}) {
  const inner = (
    <>
      <span className="block text-[11.5px] uppercase tracking-wide text-textSecondary">{label}</span>
      <span className={`mt-1 block text-[15px] font-semibold text-white ${mono ? "font-mono text-[13.5px]" : ""}`}>
        {value}
      </span>
    </>
  );
  const cls =
    "block rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3.5 transition-colors";
  return href ? (
    <Link href={href} className={`${cls} hover:border-white/15 hover:bg-white/[0.04]`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-[132px] w-full bg-white/[0.04] sm:h-[180px] sm:rounded-2xl" />
      <div className="px-4 pt-[52px] sm:px-6 sm:pl-[168px] sm:pt-4">
        <div className="h-6 w-48 rounded bg-white/[0.06]" />
        <div className="mt-2 h-4 w-32 rounded bg-white/[0.04]" />
      </div>
    </div>
  );
}

function EmptyState({
  title,
  body,
  action,
  onRetry,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
  onRetry?: () => void;
}) {
  return (
    <div className="mx-4 mt-10 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-6 py-12 text-center sm:mx-0">
      <p className="text-[16px] font-semibold text-white">{title}</p>
      <p className="mx-auto mt-2 max-w-[42ch] text-[13.5px] leading-relaxed text-textSecondary">{body}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-5 inline-block rounded-full bg-white px-5 py-2 text-[13px] font-semibold text-black transition-opacity hover:opacity-90"
        >
          {action.label}
        </Link>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-block rounded-full border border-white/15 px-5 py-2 text-[13px] font-semibold text-white transition-colors hover:border-white/30"
        >
          Try again
        </button>
      )}
    </div>
  );
}
