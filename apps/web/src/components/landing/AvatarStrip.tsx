import Link from "next/link";

/*
 * A row of circular monogram avatars over a caption.
 *
 * This is the treatment a testimonial wall would use — overlapping portraits,
 * a hover lift, a line of supporting text — applied to something that is
 * actually true. FurlPay has no customers to quote yet, and the page says so
 * in ProofSection; inventing six smiling faces to fill the shape would be the
 * one thing this codebase is most careful never to do.
 *
 * So the avatars are the integrations that exist. Monograms rather than
 * vendor logos: shipping another project's mark implies an endorsement that
 * has not been given, and the SVGs are not ours to vendor. A letterform in a
 * ring is ours, costs no request, and scales to any name.
 *
 * A Server Component — the overlap, the lift and the ring are CSS, so this
 * adds nothing to the bundle.
 */

export interface AvatarItem {
  /** Full name, shown in the caption and used for the accessible label. */
  name: string;
  /** Optional destination; without one the avatar is inert and non-focusable. */
  href?: string;
}

/* Two letters where a name is two words (Vercel AI SDK → VA), otherwise one.
   Enough to be distinguishable at 40px without becoming unreadable. */
function monogram(name: string): string {
  const words = name.split(/[\s-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function AvatarStrip({
  items,
  caption,
  className = "",
}: {
  items: AvatarItem[];
  /** One line under the row. Say what the avatars are, not how many. */
  caption?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center gap-4 sm:items-start ${className}`.trim()}>
      {/* -space-x-2 overlaps the circles the way a stacked-portrait row does.
          Each avatar carries the page background as its ring, so the overlap
          reads as depth rather than as two shapes colliding. */}
      <ul className="avatar-row flex flex-wrap items-center justify-center gap-y-3 -space-x-2 sm:justify-start">
        {items.map((item) => {
          const initials = monogram(item.name);
          const face = (
            <span
              className="avatar-chip flex h-10 w-10 items-center justify-center rounded-full ring-2 ring-black font-mono text-[12px] font-semibold text-textSecondary"
              /* The title is for pointer users; the accessible name comes from
                 the visually-hidden span below, so a screen reader announces
                 "LangChain", never "LC". */
              title={item.name}
            >
              <span aria-hidden="true">{initials}</span>
              <span className="sr-only">{item.name}</span>
            </span>
          );

          return (
            <li key={item.name} className="relative">
              {item.href ? (
                <Link href={item.href} className="block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon">
                  {face}
                </Link>
              ) : (
                face
              )}
            </li>
          );
        })}
      </ul>

      {caption && (
        <p className="max-w-md text-center text-[13px] leading-relaxed text-textMuted sm:text-left">
          {caption}
        </p>
      )}
    </div>
  );
}
