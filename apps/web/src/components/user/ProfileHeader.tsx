"use client";

import Link from "next/link";
import { BadgeCheck, Copy, Check, Settings, Share2 } from "lucide-react";
import { useState } from "react";
import UserAvatar from "./UserAvatar";
import ProfileStats, { accountAge, type ProfileStat } from "./ProfileStats";

// ---------------------------------------------------------------------------
// The cover band, the overlapping avatar, and the identity block beside it.
//
// ── THE OVERLAP IS THE WHOLE LAYOUT PROBLEM ────────────────────────────────
//
// The avatar hangs off the bottom edge of the cover. Done with a negative
// margin it collapses differently at every breakpoint and clips inside an
// `overflow-hidden` cover. Done with absolute positioning inside a `relative`
// wrapper — as here — the cover keeps its own height, the avatar sits at a
// fixed offset from the cover's bottom edge, and the content below is pushed
// clear by explicit padding rather than by whatever the avatar happens to
// measure.
//
// The cover itself is `overflow-hidden` for its gradient, so the avatar CANNOT
// live inside it. It is a sibling, positioned against the same wrapper.
//
// ── THE RING IS A CUTOUT, NOT A BORDER ─────────────────────────────────────
//
// The avatar carries a 4px ring in the PAGE background colour, which is what
// makes it read as punched through the cover rather than pasted on top. That is
// `ringStrong` on UserAvatar; it has to match the page ground (#08080A) or the
// illusion breaks.
//
// ── RESPONSIVE ─────────────────────────────────────────────────────────────
//
// Below `sm` the identity block sits UNDER the avatar and the actions go full
// width, because a 128px avatar plus a name plus two buttons does not fit on a
// 360px row without truncating the name to nothing. From `sm` up it is the
// familiar single row.
// ---------------------------------------------------------------------------

export interface ProfileHeaderProps {
  name: string;
  /** Rendered with a leading @. Omitted entirely when absent. */
  handle?: string | null;
  avatarUrl?: string | null;
  initials?: string | null;
  bio?: string | null;
  verified?: boolean;
  /** ISO date the account was created, for the "Member for" stat. */
  memberSince?: string | null;
  stats?: ProfileStat[];
  followers?: number;
  following?: number;
  /** Shown under the actions, e.g. a wallet address. Copyable. */
  copyValue?: { label: string; value: string } | null;
  editHref?: string;
}

export default function ProfileHeader({
  name,
  handle,
  avatarUrl,
  initials,
  bio,
  verified = false,
  memberSince,
  stats = [],
  followers,
  following,
  copyValue,
  editHref = "/profile",
}: ProfileHeaderProps) {
  const [copied, setCopied] = useState(false);

  const age = accountAge(memberSince);
  const allStats: ProfileStat[] = [...(age ? [{ label: "on FurlPay", value: age }] : []), ...stats];

  async function copy() {
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(copyValue.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (insecure context, or denied). The value is visible
      // on screen either way, so there is nothing to recover from.
    }
  }

  return (
    <header className="relative">
      {/* Cover. A flat dark field with a single soft brand wash — not a
          gradient showpiece. The reference is a premium fintech surface, where
          the cover is a ground for the identity block rather than the subject. */}
      <div
        className="h-[132px] w-full overflow-hidden rounded-b-none border-b border-white/[0.06] sm:h-[180px] sm:rounded-2xl sm:border"
        style={{
          background:
            "radial-gradient(120% 140% at 12% 0%, rgba(0,229,153,0.16) 0%, rgba(0,229,153,0.04) 38%, rgba(255,255,255,0.02) 62%, rgba(255,255,255,0) 100%), #0E0E11",
        }}
        aria-hidden
      />

      {/* The avatar, overlapping the cover's bottom-left. Absolute against this
          header so the cover can stay overflow-hidden. */}
      <div className="absolute left-4 top-[132px] -translate-y-1/2 sm:left-6 sm:top-[180px]">
        <UserAvatar
          name={name}
          avatarUrl={avatarUrl}
          initials={initials}
          size="header"
          ringStrong
          decorative={false}
          className="h-[88px] w-[88px] sm:h-[128px] sm:w-[128px]"
        />
      </div>

      {/* Identity + actions. Left padding clears the avatar from `sm` up; below
          that the block sits underneath it. */}
      <div className="px-4 pb-2 pt-[52px] sm:px-6 sm:pl-[168px] sm:pt-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="flex items-center gap-1.5 text-[22px] font-bold leading-tight text-white sm:text-[26px]">
              <span className="truncate">{name}</span>
              {verified && (
                <BadgeCheck
                  className="h-[18px] w-[18px] shrink-0 text-neon"
                  aria-label="Verified account"
                />
              )}
            </h1>

            {handle && (
              <p className="mt-0.5 truncate text-[13.5px] text-textSecondary">@{handle}</p>
            )}

            {bio && (
              <p className="mt-2 max-w-[52ch] text-[13.5px] leading-relaxed text-textMuted">{bio}</p>
            )}

            <ProfileStats
              className="mt-3"
              stats={allStats}
              followers={followers}
              following={following}
            />
          </div>

          {/* Actions. Full width on a phone so the primary action is a real
              target rather than a 90px pill floating beside a truncated name. */}
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={editHref}
              className="flex-1 rounded-full bg-white px-4 py-2 text-center text-[13px] font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 sm:flex-none"
            >
              Edit profile
            </Link>

            {copyValue && (
              <button
                type="button"
                onClick={copy}
                aria-label={copied ? `${copyValue.label} copied` : `Copy ${copyValue.label}`}
                title={copyValue.label}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/12 text-textSecondary transition-colors hover:border-white/25 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
              >
                {copied ? (
                  <Check className="h-[15px] w-[15px] text-neon" aria-hidden />
                ) : (
                  <Copy className="h-[15px] w-[15px]" aria-hidden />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                const url = typeof window !== "undefined" ? window.location.href : "";
                if (navigator.share) void navigator.share({ title: name, url }).catch(() => {});
                else void navigator.clipboard?.writeText(url).catch(() => {});
              }}
              aria-label="Share profile"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/12 text-textSecondary transition-colors hover:border-white/25 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
            >
              <Share2 className="h-[15px] w-[15px]" aria-hidden />
            </button>

            <Link
              href="/profile#preferences"
              aria-label="Account settings"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/12 text-textSecondary transition-colors hover:border-white/25 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
            >
              <Settings className="h-[15px] w-[15px]" aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
