import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";
import type { ContentCategory, Speaker } from "@/lib/content";

// Small shared pieces for the content platform. Kept in one file because each
// is a handful of lines and splitting them would be more import noise than
// structure — none is complex enough to own a module.

// ── Hero ───────────────────────────────────────────────────────────────────

export function ContentHero({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="max-w-3xl">
      <p className="section-eyebrow">{eyebrow}</p>
      <h1 className="mt-3 text-[40px] font-extrabold leading-[1.08] tracking-tighter sm:text-[52px]">
        {title}
      </h1>
      <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-textSecondary">{lead}</p>
      {children}
    </header>
  );
}

// ── Category filter ────────────────────────────────────────────────────────

/**
 * Links, not buttons.
 *
 * Each category is a real URL (?category=Payments), so filtering works without
 * JavaScript, is shareable, survives a back-navigation and needs no client
 * component. The page is a server component that reads the search param — the
 * filter ships zero JS.
 *
 * On mobile the row scrolls horizontally rather than wrapping into a block
 * that pushes the content off-screen.
 */
export function CategoryFilter({
  categories,
  active,
  basePath,
}: {
  categories: ContentCategory[];
  active?: string;
  basePath: string;
}) {
  if (!categories.length) return null;
  const all = [{ label: "All", href: basePath, on: !active }].concat(
    categories.map((c) => ({
      label: c,
      href: `${basePath}?category=${encodeURIComponent(c)}`,
      on: active === c,
    })),
  );

  return (
    <nav aria-label="Filter by category" className="-mx-1 overflow-x-auto pb-1">
      <ul className="flex w-max gap-2 px-1">
        {all.map((c) => (
          <li key={c.label}>
            <Link
              href={c.href}
              aria-current={c.on ? "page" : undefined}
              className={`inline-block whitespace-nowrap rounded-pill border px-3.5 py-1.5 text-[13px]
                          font-medium transition-colors ${
                            c.on
                              ? "border-neon/40 bg-neon/10 text-neon"
                              : "border-white/12 text-textSecondary hover:border-white/25 hover:text-white"
                          }`}
            >
              {c.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

/**
 * Shown whenever there is nothing to list.
 *
 * This is the state both hubs are in today, so it is written to be worth
 * reading rather than an apology — it says what the section is for and offers
 * the next useful step, instead of leaving a blank screen under a hero.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="rounded-card border border-dashed border-white/12 bg-white/[0.015] px-6 py-14 text-center">
      <Inbox aria-hidden className="mx-auto h-7 w-7 text-white/25" />
      <h2 className="mt-4 text-[17px] font-bold tracking-tight text-textPrimary">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-textSecondary">{body}</p>
      {action && (
        <Link
          href={action.href}
          className="btn-outline mt-6 inline-flex items-center gap-2 px-6 py-2.5 text-[14px]"
        >
          {action.label}
          <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

// ── Speaker ────────────────────────────────────────────────────────────────

export function SpeakerCard({ speaker }: { speaker: Speaker }) {
  const initials = speaker.name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex gap-4 rounded-card border border-white/10 bg-white/[0.02] p-5">
      {/* Initials rather than a stock avatar when there is no photo — an
          invented face on a speaker card is a small lie with a big blast
          radius. */}
      <span
        aria-hidden
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-neon/25 bg-neonSoft text-[14px] font-bold text-neon"
      >
        {initials || "·"}
      </span>
      <div className="min-w-0">
        <p className="text-[15px] font-bold tracking-tight text-textPrimary">{speaker.name}</p>
        <p className="mt-0.5 text-[13px] text-textSecondary">
          {speaker.title}
          {speaker.company ? ` · ${speaker.company}` : ""}
        </p>
        {speaker.bio && (
          <p className="mt-2 text-[13px] leading-relaxed text-textSecondary">{speaker.bio}</p>
        )}
        {speaker.link && (
          <a
            href={speaker.link}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-[13px] font-semibold text-neon hover:underline"
          >
            Profile
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </div>
    </div>
  );
}

// ── Key finding ────────────────────────────────────────────────────────────

/** Numbered research finding. Data-driven — the number is positional only. */
export function KeyFindingItem({
  index,
  title,
  detail,
}: {
  index: number;
  title: string;
  detail: string;
}) {
  return (
    <li className="flex gap-5 border-t border-white/10 py-6 first:border-t-0 first:pt-0">
      <span
        aria-hidden
        className="shrink-0 font-mono text-[13px] font-bold tabular-nums text-neon"
      >
        {String(index + 1).padStart(2, "0")}
      </span>
      <div>
        <h3 className="text-[17px] font-bold leading-snug tracking-tight text-textPrimary">
          {title}
        </h3>
        <p className="mt-2 text-[15px] leading-relaxed text-textSecondary">{detail}</p>
      </div>
    </li>
  );
}

// ── Related content ────────────────────────────────────────────────────────

export function RelatedContent({
  heading,
  items,
}: {
  heading: string;
  items: { slug: string; title: string; href: string; meta?: string }[];
}) {
  if (!items.length) return null;
  return (
    <section className="mt-16">
      <h2 className="text-[22px] font-bold tracking-tight">{heading}</h2>
      <ul className="mt-5 divide-y divide-white/10 border-y border-white/10">
        {items.map((i) => (
          <li key={i.slug}>
            <Link
              href={i.href}
              className="flex items-center justify-between gap-4 py-4 transition-colors hover:text-neon"
            >
              <span>
                <span className="block text-[15px] font-semibold">{i.title}</span>
                {i.meta && <span className="mt-0.5 block text-[12px] text-textMuted">{i.meta}</span>}
              </span>
              <ArrowRight aria-hidden className="h-4 w-4 shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
