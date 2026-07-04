import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ArrowRight, Clock } from "lucide-react";
import { GUIDE_CATEGORY_ICONS } from "@/components/travel/guideIcons";
import { GUIDES, getGuide } from "@/lib/travel/guides";

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const g = getGuide(params.slug);
  if (!g) return {};
  return { title: `${g.title} — FurlPay Travels`, description: g.excerpt };
}

export default function GuidePage({ params }: { params: { slug: string } }) {
  const g = getGuide(params.slug);
  if (!g) notFound();

  const related = GUIDES.filter((x) => x.slug !== g.slug && x.category === g.category).slice(0, 2);
  const fallback = GUIDES.filter((x) => x.slug !== g.slug).slice(0, 2);
  const more = related.length ? related : fallback;
  const Icon = GUIDE_CATEGORY_ICONS[g.category];

  return (
    <div className="mx-auto max-w-3xl px-5 pb-24 pt-6">
      <Link href="/travel/guides" className="mb-5 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Travel guides
      </Link>

      <div className="flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-neon/10 text-neon">
          <Icon className="h-5 w-5" />
        </span>
        <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-textSecondary">
          {g.category}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-textSecondary">
          <Clock className="h-3 w-3" /> {g.readMins} min read
        </span>
      </div>

      <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">{g.title}</h1>
      <p className="mt-3 text-sm text-textSecondary">{g.excerpt}</p>

      <article className="mt-8 space-y-8">
        {g.sections.map((s, i) => (
          <section key={i}>
            {s.h2 && <h2 className="mb-3 text-xl font-bold text-white">{s.h2}</h2>}
            {s.paragraphs.map((p, j) => (
              <p key={j} className="mb-3 text-sm leading-relaxed text-textSecondary">
                {p}
              </p>
            ))}
            {s.bullets && (
              <ul className="mt-2 space-y-2">
                {s.bullets.map((b) => (
                  <li key={b} className="flex gap-2 text-sm text-textSecondary">
                    <span className="text-neon">•</span> {b}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </article>

      {g.cta && (
        <Link
          href={g.cta.href}
          className="mt-10 flex items-center justify-between rounded-card border border-white/10 bg-gradient-to-br from-sky-500/[0.12] via-charcoal to-teal-500/[0.10] p-5 transition hover:border-white/25"
        >
          <span className="text-sm font-bold text-white">{g.cta.label}</span>
          <ArrowRight className="h-5 w-5 text-neon" />
        </Link>
      )}

      {/* Keep reading */}
      <section className="mt-12">
        <h2 className="mb-4 text-lg font-bold text-white">Keep reading</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {more.map((r) => {
            const RIcon = GUIDE_CATEGORY_ICONS[r.category];
            return (
              <Link
                key={r.slug}
                href={`/travel/guides/${r.slug}`}
                className="group rounded-card border border-white/10 bg-charcoal p-4 transition hover:border-white/25"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neon/10 text-neon">
                  <RIcon className="h-4 w-4" />
                </span>
                <h3 className="mt-2 text-sm font-bold leading-snug text-white">{r.title}</h3>
                <p className="mt-1.5 line-clamp-2 text-xs text-textSecondary">{r.excerpt}</p>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
