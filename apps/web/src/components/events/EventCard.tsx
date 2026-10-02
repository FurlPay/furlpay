import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin } from "lucide-react";
import {
  eventStatus,
  formatDateRange,
  formatLocation,
  participationLabel,
  statusLabel,
  type FurlpayEvent,
} from "@/lib/events/events";

// One event card, used by the /events grid and by "other events" rails.
//
// ── WHY THE LINK IS INSIDE THE HEADING ─────────────────────────────────────
//
// The whole card is clickable, but it is NOT a <div onClick> and it is not
// wrapped in one giant <a> either. The anchor sits on the title and is
// stretched over the card with an ::after overlay (`card-hit`). That keeps
// exactly one tab stop per card, gives a screen reader the event name as the
// link text instead of a recital of every date and badge inside it, and still
// lets someone select the text or middle-click to open in a new tab.
//
// The image is decorative here — the title carries the name — so its alt stays
// empty when the event has no distinct art to describe.

/** Status pill colours. Past events are muted so the eye lands on live ones. */
const STATUS_STYLES: Record<string, string> = {
  upcoming: "border-neon/30 bg-neon/10 text-neon",
  happening: "border-neon/50 bg-neon/15 text-neon",
  past: "border-white/10 bg-white/[0.04] text-textMuted",
};

export default function EventCard({
  event,
  now,
  priority = false,
}: {
  event: FurlpayEvent;
  /** Injected so a test and the server agree on "today". */
  now?: Date;
  /** Set on the first card above the fold. */
  priority?: boolean;
}) {
  const status = eventStatus(event, now);
  const isPast = status === "past";

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-card border border-white/10
                  bg-white/[0.02] transition-[transform,border-color,background-color]
                  duration-200 ease-out hover:-translate-y-1 hover:border-white/25
                  hover:bg-white/[0.04] focus-within:border-neon/40
                  ${isPast ? "opacity-[0.85] hover:opacity-100" : ""}`}
    >
      {/* Art panel — fixed aspect so a grid row stays even whatever the
          artwork is. object-contain, never cover: a third-party event logo
          must not be cropped or stretched to fill a box. */}
      <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden border-b border-white/10 bg-gradient-to-br from-white/[0.06] via-black to-black">
        {event.image ? (
          <Image
            src={event.image}
            alt=""
            width={event.imageWidth ?? 833}
            height={event.imageHeight ?? 400}
            sizes="(min-width: 1024px) 384px, (min-width: 640px) 45vw, 90vw"
            priority={priority}
            className="absolute inset-0 h-full w-full object-contain p-7 transition-transform duration-300 ease-out group-hover:scale-[1.03]"
          />
        ) : (
          // No artwork on file: a typographic panel from our own tokens rather
          // than a grey placeholder or an invented logo.
          <div className="absolute inset-0 flex flex-col justify-center gap-1.5 px-6">
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neon/70">
              {event.category}
            </span>
            <span className="max-w-[92%] text-[19px] font-extrabold leading-tight tracking-tighter text-white/90">
              {event.name}
            </span>
          </div>
        )}

        <span
          className={`absolute right-3 top-3 rounded-pill border px-2.5 py-1 text-[10px]
                      font-bold uppercase tracking-[0.12em] backdrop-blur-sm ${STATUS_STYLES[status]}`}
        >
          {statusLabel(status)}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-textMuted">
          {event.category}
        </p>

        <h3 className="mt-2 text-[18px] font-bold leading-snug tracking-tight text-textPrimary">
          <Link href={`/events/${event.slug}`} className="card-hit">
            {event.name}
          </Link>
        </h3>

        <dl className="mt-3 space-y-1.5 text-[13px] text-textSecondary">
          <div className="flex items-start gap-2">
            <dt className="sr-only">Dates</dt>
            <CalendarDays aria-hidden className="mt-[2px] h-4 w-4 shrink-0 text-neon/80" />
            <dd>{formatDateRange(event.startDate, event.endDate)}</dd>
          </div>
          <div className="flex items-start gap-2">
            <dt className="sr-only">Location</dt>
            <MapPin aria-hidden className="mt-[2px] h-4 w-4 shrink-0 text-neon/80" />
            <dd>{formatLocation(event)}</dd>
          </div>
        </dl>

        <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed text-textSecondary">
          {event.summary}
        </p>

        <div className="mt-auto flex items-center justify-between gap-3 pt-5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-textMuted">
            {participationLabel(event, now)}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-neon">
            View event
            <ArrowRight
              aria-hidden
              className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </span>
        </div>
      </div>
    </article>
  );
}
