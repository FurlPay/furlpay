import Image from "next/image";
import Link from "next/link";
import { ArrowRight, FileText, PlayCircle } from "lucide-react";
import type { ContentSummary } from "@/lib/content";
import { formatDate } from "@/lib/content";

// One card for both content types.
//
// Webinars and reports differ in aspect ratio and in what the meta line says,
// but everything else — the stretched link, the badge, the hover behaviour, the
// focus treatment — is identical, and duplicating it into two components is how
// the two drift apart. The `type` discriminates; nothing else does.
//
// The link sits on the TITLE and is stretched over the card with `card-hit`
// (globals.css). One tab stop per card, and a screen reader hears the title as
// the link name rather than a recital of every badge and date inside it.

export default function ContentCard({
  item,
  priority = false,
}: {
  item: ContentSummary;
  priority?: boolean;
}) {
  const isReport = item.type === "report";
  const Icon = isReport ? FileText : PlayCircle;

  return (
    <article
      className="group relative flex flex-col overflow-hidden rounded-card border border-white/10
                 bg-white/[0.02] transition-[transform,border-color,background-color] duration-200
                 ease-out hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.04]
                 focus-within:border-neon/40"
    >
      <div
        className={`relative w-full shrink-0 overflow-hidden border-b border-white/10
                    bg-gradient-to-br from-white/[0.06] via-black to-black
                    ${isReport ? "aspect-[3/4]" : "aspect-[16/9]"}`}
      >
        {item.image ? (
          <Image
            src={item.image}
            alt=""
            fill
            sizes="(min-width: 1024px) 380px, (min-width: 640px) 45vw, 90vw"
            priority={priority}
            className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
          />
        ) : (
          // No artwork on file: a typographic panel from our own tokens rather
          // than a grey box or an invented stock image.
          <div className="absolute inset-0 flex flex-col justify-end gap-2 p-5">
            <Icon aria-hidden className="h-6 w-6 text-neon/60" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neon/70">
              {item.category}
            </span>
            <span className="text-[17px] font-extrabold leading-tight tracking-tighter text-white/90">
              {item.title}
            </span>
          </div>
        )}

        {item.badge && (
          <span
            className="absolute right-3 top-3 rounded-pill border border-white/15 bg-black/70
                       px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]
                       text-textMuted backdrop-blur-sm"
          >
            {item.badge}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-textMuted">
          {item.category}
        </p>

        <h3 className="mt-2 text-[17px] font-bold leading-snug tracking-tight text-textPrimary">
          <Link href={item.href} className="card-hit">
            {item.title}
          </Link>
        </h3>

        <p className="mt-2.5 line-clamp-3 text-[13px] leading-relaxed text-textSecondary">
          {item.description}
        </p>

        <div className="mt-auto flex items-center justify-between gap-3 pt-5">
          <span className="text-[12px] text-textMuted">
            {item.date ? formatDate(item.date) : ""}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-neon">
            {isReport ? "Read" : "View"}
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
