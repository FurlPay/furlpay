"use client";

import { useState } from "react";
import { User as UserIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// The one component that draws a person's face.
//
// ── WHY A SINGLE SOURCE OF TRUTH ───────────────────────────────────────────
//
// Before this, the avatar was redrawn inline in ProfileMenu, again in
// ContactAvatar, and again anywhere a face was needed. Each copy made its own
// decision about shape, fallback order and what to do with a broken image, and
// the visible result was a picture that was a circle in the header and a
// rounded rectangle in a list. Every surface that shows a user now renders THIS
// component, so "the avatar is a perfect circle" is one fact rather than a
// convention everyone has to remember.
//
// ── THE CIRCLE IS NOT NEGOTIABLE, AND IT IS NOT JUST border-radius ─────────
//
// A `border-radius: 9999px` on a non-square box gives an ellipse, and
// `object-fit: cover` on a box whose aspect ratio drifts gives a subtly
// cropped-wrong face. Three properties have to hold together:
//
//   aspect-ratio: 1 / 1   the box is square whatever the layout does to it
//   overflow: hidden      the image cannot paint outside the circle
//   object-fit: cover     the image fills the square, centre-cropped, never
//                         stretched — a portrait and a landscape photo both
//                         come out as the same circle with the middle showing
//
// Tailwind's `aspect-square` + `rounded-full` + `object-cover` express exactly
// those, and the explicit width/height stop the box collapsing inside a flex
// row before the image loads.
//
// ── FALLBACK ORDER, AND WHY THERE IS NO IDENTICON ─────────────────────────
//
//   photo → initials → silhouette
//
// No generated identicon and no placeholder initials: two letters that stand
// for nothing look exactly like two letters that stand for someone. A user with
// no name gets the silhouette, which is honest about knowing nothing.
// ---------------------------------------------------------------------------

/** The sizes the product actually uses. A free-form number would let every
 *  caller invent its own, which is how a design system stops being one. */
export const AVATAR_SIZES = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 56,
  xl: 96,
  /** The large overlapping avatar on the profile header. */
  header: 128,
} as const;

export type AvatarSize = keyof typeof AVATAR_SIZES;

/** Initials as a person would read the name: first letter of the first word
 *  plus first letter of the last, ignoring anything that is not a letter or
 *  digit so "🦊 fox" reads as "F" rather than an empty box. */
export function userInitials(name: string | null | undefined): string | null {
  if (!name) return null;
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return null;
  const first = [...words[0]!][0] ?? "";
  const last = words.length > 1 ? ([...words[words.length - 1]!][0] ?? "") : "";
  const out = (first + last).toUpperCase();
  return out || null;
}

/** Type scale for the initials, so they stay optically centred at every size. */
function initialsClass(px: number): string {
  if (px <= 24) return "text-[9px]";
  if (px <= 32) return "text-[11px]";
  if (px <= 40) return "text-[13px]";
  if (px <= 56) return "text-[18px]";
  if (px <= 96) return "text-[30px]";
  return "text-[40px]";
}

export interface UserAvatarProps {
  name?: string | null;
  avatarUrl?: string | null;
  /** Pre-computed initials from the session; derived from `name` when absent. */
  initials?: string | null;
  size?: AvatarSize;
  /** A hairline ring separating the avatar from whatever sits behind it. */
  ring?: boolean;
  /** The thicker ring the profile header uses to lift the avatar off the cover. */
  ringStrong?: boolean;
  /** Skeleton state, for a session that has not resolved yet. */
  loading?: boolean;
  className?: string;
  /** Decorative avatars beside a visible name should stay out of the a11y tree. */
  decorative?: boolean;
}

export default function UserAvatar({
  name,
  avatarUrl,
  initials,
  size = "md",
  ring = false,
  ringStrong = false,
  loading = false,
  className = "",
  decorative = true,
}: UserAvatarProps) {
  const [broken, setBroken] = useState(false);
  const px = AVATAR_SIZES[size];

  // The ring is `box-shadow: inset`, not `border`. A border participates in the
  // box model and would shrink the image inside the circle by two pixels at
  // every size; an inset shadow paints over the edge and changes nothing.
  const ringStyle = ringStrong
    ? { boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.14), 0 0 0 4px #08080A" }
    : ring
      ? { boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)" }
      : undefined;

  const shell =
    "relative inline-flex shrink-0 aspect-square overflow-hidden rounded-full bg-white/[0.06] " +
    "items-center justify-center select-none";

  if (loading) {
    return (
      <span
        aria-hidden
        className={`${shell} animate-pulse ${className}`}
        style={{ width: px, height: px, ...ringStyle }}
      />
    );
  }

  const resolved = initials ?? userInitials(name);
  const label = decorative ? undefined : name ? `${name}'s profile picture` : "Profile picture";

  return (
    <span
      className={`${shell} ${className}`}
      style={{ width: px, height: px, ...ringStyle }}
      role={decorative ? undefined : "img"}
      aria-label={label}
      aria-hidden={decorative || undefined}
      title={name ?? undefined}
    >
      {avatarUrl && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- the source is
        // either a data: URL we re-encoded ourselves or a provider host;
        // next/image would need every one in remotePatterns and buys nothing
        // for a square that is already the right size.
        <img
          src={avatarUrl}
          alt=""
          width={px}
          height={px}
          referrerPolicy="no-referrer"
          decoding="async"
          onError={() => setBroken(true)}
          // h-full w-full over the square shell: the image can never set the
          // box's shape, only fill it.
          className="h-full w-full rounded-full object-cover"
        />
      ) : resolved ? (
        <span
          aria-hidden
          className={`grid h-full w-full place-items-center rounded-full bg-gradient-to-br from-neon/25 to-neon/10 font-bold text-white ${initialsClass(px)}`}
        >
          {resolved}
        </span>
      ) : (
        <UserIcon
          aria-hidden
          className="text-textSecondary"
          style={{ width: Math.round(px * 0.46), height: Math.round(px * 0.46) }}
        />
      )}
    </span>
  );
}
