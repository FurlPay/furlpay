import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin } from "lucide-react";
import {
  featuredEvent,
  formatDateRange,
  formatLocation,
  participationLabel,
} from "@/lib/events/events";

// A slim "where to find us next" strip for the landing page.
//
// ── IT RETIRES ITSELF ──────────────────────────────────────────────────────
//
// The event comes from featuredEvent(), which only ever returns an event that
// has not finished. So the morning after TOKEN2049 ends this renders null and
// the home page closes over it — no stale "come and meet us in Singapore" strip
// left on the front page for months, and nobody has to remember to take it
// down. The same reason event status is derived rather than stored.
//
// Returning null also means the landing page is unchanged whenever there is
// nothing upcoming, rather than showing an empty shell.

export default function EventBanner() {
  const event = featuredEvent();
  if (!event) return null;

  return (
    <div className="section pt-2">
      <Link
        href={`/events/${event.slug}`}
        className="group flex flex-col gap-4 rounded-card border border-neon/20
                   bg-gradient-to-r from-neon/[0.07] via-white/[0.02] to-transparent
                   p-4 transition-[border-color,background-color] duration-200
                   hover:border-neon/40 hover:bg-neon/[0.04] sm:flex-row sm:items-center sm:gap-5 sm:p-5"
      >
        {/* The official event mark, contained so it is never cropped or
            stretched. Fixed box height keeps the strip's rhythm whatever the
            next event's artwork happens to be. */}
        {event.image && (
          <span className="flex h-11 w-[150px] shrink-0 items-center justify-start sm:w-[168px]">
            <Image
              src={event.image}
              alt={event.imageAlt ?? event.name}
              width={event.imageWidth ?? 833}
              height={event.imageHeight ?? 400}
              sizes="168px"
              className="h-full w-auto max-w-full object-contain object-left"
            />
          </span>
        )}

        <span className="hidden h-9 w-px shrink-0 bg-white/10 sm:block" />

        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-neon">
            {participationLabel(event)}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-textSecondary">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays aria-hidden className="h-3.5 w-3.5 text-neon/80" />
              {formatDateRange(event.startDate, event.endDate)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin aria-hidden className="h-3.5 w-3.5 text-neon/80" />
              {formatLocation(event)}
            </span>
          </span>
        </span>

        <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-neon">
          Meet us there
          <ArrowRight
            aria-hidden
            className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </span>
      </Link>
    </div>
  );
}
