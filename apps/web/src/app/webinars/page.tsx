import LandingChrome from "@/components/landing/LandingChrome";
import JsonLd from "@/components/JsonLd";
import ContentCard from "@/components/content/ContentCard";
import { CategoryFilter, ContentHero, EmptyState } from "@/components/content/ContentShell";
import { seoMetadata } from "@/lib/seo/meta";
import { breadcrumb } from "@/lib/seo/schema";
import {
  activeCategories,
  CONTENT_CATEGORIES,
  featuredWebinar,
  publishedWebinars,
  webinarSummary,
  type ContentCategory,
} from "@/lib/content";

// /webinars — the FurlPay session hub. Server-rendered; see /reports for why
// the filter is links rather than state.

export const metadata = seoMetadata({
  title: "Webinars",
  description:
    "FurlPay webinars: conversations on stablecoins, payments, global banking, Web3 infrastructure and the future of money.",
  path: "/webinars",
  ogTitle: "FurlPay Webinars",
});

export default async function WebinarsPage(props: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await props.searchParams;

  const all = publishedWebinars();
  const categories = activeCategories(all);
  const active = CONTENT_CATEGORIES.includes(category as ContentCategory)
    ? (category as ContentCategory)
    : undefined;

  const shown = active ? all.filter((w) => w.category === active) : all;
  const featured = active ? undefined : featuredWebinar();
  const grid = featured ? shown.filter((w) => w.slug !== featured.slug) : shown;

  const upcoming = grid.filter((w) => w.sessionStatus !== "on-demand");
  const onDemand = grid.filter((w) => w.sessionStatus === "on-demand");

  return (
    <div className="min-h-screen bg-oled text-textPrimary">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Webinars", path: "/webinars" },
        ])}
      />

      <main className="section pb-24 pt-14">
        <ContentHero
          eyebrow="FurlPay Webinars"
          title="Conversations shaping the future of finance"
          lead="Working sessions on stablecoin payments, global banking rails, Web3 infrastructure and the practical problems of moving money across borders — with the people building them."
        />

        {categories.length > 1 && (
          <div className="mt-10">
            <CategoryFilter categories={categories} active={active} basePath="/webinars" />
          </div>
        )}

        {all.length === 0 ? (
          <div className="mt-12">
            {/* FurlPay has not run a session yet. Nothing here invents one. */}
            <EmptyState
              title="No webinars scheduled yet"
              body="The first FurlPay sessions are being planned. Events is where our in-person appearances are listed in the meantime."
              action={{ label: "See where we will be", href: "/events" }}
            />
          </div>
        ) : (
          <>
            {featured && (
              <section aria-labelledby="featured-webinar" className="mt-12">
                <h2 id="featured-webinar" className="sr-only">
                  Featured webinar
                </h2>
                <div className="max-w-2xl">
                  <ContentCard item={webinarSummary(featured)} priority />
                </div>
              </section>
            )}

            {upcoming.length > 0 && (
              <Section id="upcoming" title="Upcoming and live" items={upcoming} />
            )}
            {onDemand.length > 0 && <Section id="on-demand" title="On demand" items={onDemand} />}

            {shown.length === 0 && active && (
              <div className="mt-12">
                <EmptyState
                  title={`No webinars in ${active} yet`}
                  body="Nothing published under this category so far."
                  action={{ label: "See all webinars", href: "/webinars" }}
                />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Section({
  id,
  title,
  items,
}: {
  id: string;
  title: string;
  items: ReturnType<typeof publishedWebinars>;
}) {
  return (
    <section aria-labelledby={id} className="mt-14">
      <div className="flex items-baseline justify-between border-b border-white/10 pb-4">
        <h2 id={id} className="text-[22px] font-bold tracking-tight">
          {title}
        </h2>
        <span className="text-[13px] text-textMuted">
          {items.length} {items.length === 1 ? "session" : "sessions"}
        </span>
      </div>
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((w) => (
          <ContentCard key={w.slug} item={webinarSummary(w)} />
        ))}
      </div>
    </section>
  );
}
