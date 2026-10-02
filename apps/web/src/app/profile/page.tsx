"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ProfileMenu from "@/components/auth/ProfileMenu";
import { useSession } from "@/components/auth/SessionProvider";
import { getProfile, type Profile } from "@/lib/accountApi";
import DangerZone from "@/components/profile/DangerZone";
import IdentitySection from "@/components/profile/IdentitySection";
import PreferencesSection from "@/components/profile/PreferencesSection";
import SecuritySection from "@/components/profile/SecuritySection";
import SessionsSection from "@/components/profile/SessionsSection";
import VerificationSection from "@/components/profile/VerificationSection";
import WalletSection from "@/components/profile/WalletSection";
import { RowSkeleton, Section } from "@/components/profile/primitives";

// ---------------------------------------------------------------------------
// Account settings.
//
// Built to read as the same product as /markets rather than as a settings
// template: the same sticky `app-ambient` header band over a hairline border,
// the same 1440px measure, the same hairline card borders and the same type
// scale. The page is FULL-BLEED for the same reason the markets terminal is —
// it is a desktop-grade surface with a section index beside it, and the 440px
// phone column this route used to render in turned every row into a two-line
// wrap on a monitor. lib/shellRoutes.ts carves it out alongside
// /dashboard/terminal and /investing/insights.
//
// The section components own their own loading, error and not-wired states.
// This file owns three things only: the header, the section index, and the
// account-level states (loading / signed out / could not load).
// ---------------------------------------------------------------------------

const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "security", label: "Security" },
  { id: "wallet", label: "Wallet & payments" },
  { id: "verification", label: "Verification" },
  { id: "preferences", label: "Preferences" },
  { id: "sessions", label: "Active sessions" },
  { id: "danger", label: "Danger zone" },
] as const;

export default function ProfilePage() {
  const { status, refresh: refreshSession } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    getProfile()
      .then(setProfile)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    // Only ask once the session is settled — a request fired during `loading`
    // races the cookie check and 401s on a first paint after sign-in.
    if (status === "loading" || status === "idle") return;
    if (status !== "authenticated") return;
    load();
  }, [status, load]);

  const signedOut = status !== "loading" && status !== "idle" && status !== "authenticated";

  return (
    <div className="min-h-screen bg-oled">
      <AccountTopBar />

      <main className="mx-auto w-full max-w-[1440px] px-5 py-6 lg:px-8 lg:py-8 2xl:px-12">
        {/* One centred block: the section index plus a single readable column, so
            the header, cards and dividers share one edge and wide screens do not
            leave the content pinned left beside a dead gap. */}
        <div className="mx-auto flex w-full max-w-[1116px] flex-col gap-8 xl:flex-row xl:gap-10">
          {/* Section index — a real nav landmark, not a decorative list. It is
              hidden below xl, where the sections simply stack in order. */}
          <nav
            aria-label="Account sections"
            className="hidden w-[196px] shrink-0 xl:block"
          >
            <div className="sticky top-[92px] flex flex-col gap-0.5">
              {SECTIONS.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="rounded-lg px-3 py-2 text-[13px] font-medium text-textSecondary transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:bg-white/[0.05] focus-visible:text-white focus-visible:outline-none"
                >
                  {s.label}
                </a>
              ))}
            </div>
          </nav>

          <div className="w-full min-w-0 max-w-[880px] flex-1">
            <header className="mb-6">
              <h1 className="text-[22px] font-bold tracking-tight text-white sm:text-[26px]">
                Account settings
              </h1>
              <p className="mt-1 text-[13px] text-textSecondary">
                Your profile, how you sign in, and what FurlPay is allowed to do on your behalf.
              </p>
            </header>

            {signedOut ? (
              <SignedOut expired={status === "expired"} />
            ) : failed ? (
              <LoadFailed onRetry={load} />
            ) : !profile ? (
              <LoadingSections />
            ) : (
              <div className="flex flex-col gap-8">
                <IdentitySection
                  profile={profile}
                  onChanged={() => {
                    load();
                    // The header avatar and name come from the session, not this
                    // page: refresh it too, so a new picture or name shows in both
                    // places at once instead of only after a reload.
                    void refreshSession();
                  }}
                />
                <SecuritySection profile={profile} onChanged={load} />
                <WalletSection profile={profile} />
                <VerificationSection profile={profile} />
                <PreferencesSection profile={profile} onChanged={load} />
                <SessionsSection profile={profile} />
                <DangerZone />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * The same header band as /markets: `app-ambient` over a hairline bottom
 * border, at the same measure. Clicking the avatar on the markets page should
 * not change the material the page is made of.
 */
function AccountTopBar() {
  return (
    <header className="app-ambient sticky top-0 z-40 border-b border-white/[0.06]">
      <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-5 py-4 sm:gap-4 lg:px-8 2xl:px-12">
        <Link
          href="/markets"
          className="tap flex shrink-0 items-center gap-2.5 rounded-lg py-1 pr-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/furlpay-mark.svg"
            alt=""
            width={30}
            height={30}
            className="h-[30px] w-[30px] rounded-[7px]"
          />
          <span className="text-[14px] font-bold tracking-tight text-white">FurlPay</span>
        </Link>

        {/* The way back. Explicit rather than relying on the browser's back
            button, because this page is also reachable from a deep link. */}
        <Link
          href="/markets"
          className="tap ml-1 hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-textSecondary transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 sm:flex"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Markets
        </Link>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}

/** The page's silhouette while the profile loads — not a centred spinner, which
 *  makes a long page appear to jump into place when it resolves. */
function LoadingSections() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading your account">
      {["Profile", "Security", "Wallet & payments"].map((title) => (
        <Section key={title} title={title}>
          <RowSkeleton rows={3} />
        </Section>
      ))}
    </div>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="max-w-[520px] rounded-card border border-white/[0.06] bg-white/[0.02] p-6">
      <h2 className="text-[15px] font-bold text-white">We could not load your account</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-textSecondary">
        The request did not come back. Nothing about your account has changed — check your
        connection and try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="tap mt-4 rounded-lg bg-accent px-4 py-2 text-[13px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Try again
      </button>
    </div>
  );
}

function SignedOut({ expired }: { expired: boolean }) {
  return (
    <div className="max-w-[520px] rounded-card border border-white/[0.06] bg-white/[0.02] p-6">
      <h2 className="text-[15px] font-bold text-white">
        {expired ? "Your session has expired" : "Sign in to manage your account"}
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-textSecondary">
        {expired
          ? "Sign in again to get back to your profile, security settings and sessions."
          : "Your profile, security settings and active sessions live behind your FurlPay sign-in."}
      </p>
      <Link
        href="/login?next=%2Fprofile"
        className="tap mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-[13px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {expired ? "Sign in again" : "Sign in"}
      </Link>
    </div>
  );
}
