import LandingChrome from "@/components/landing/LandingChrome";
import JsonLd from "@/components/JsonLd";
import ContentCard from "@/components/content/ContentCard";
import {
  CategoryFilter,
  ContentHero,
  EmptyState,
} from "@/components/content/ContentShell";
import { seoMetadata } from "@/lib/seo/meta";
import { breadcrumb } from "@/lib/seo/schema";
import {
  activeCategories,
  CONTENT_CATEGORIES,
  featuredReport,
  publishedReports,
  reportSummary,
  type ContentCategory,
} from "@/lib/content";

// /reports — the FurlPay research hub.
//
// A server component. The category filter is a set of links reading
// ?category=…, so filtering ships no JavaScript, is shareable and survives a
// back-navigation. `searchParams` makes the route dynamic, which is correct
// here: the filter is part of the URL.

export const metadata = seoMetadata({
  title: "Research",
  description:
    "FurlPay research on stablecoins, global payments, banking infrastructure, digital assets and the financial system being rebuilt around them.",
  path: "/reports",
  ogTitle: "FurlPay Research",
});

const AREAS = [
  "Stablecoins",
  "Global payments",
  "Banking infrastructure",
  "Digital assets",
  "Fintech",
  "Web3",
  "AI and agents",
  "Security",
  "Regulation",
  "Emerging markets",
];

export default async function ReportsPage(props: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await props.searchParams;

  const all = publishedReports();
  const categories = activeCategories(all);
  // An unknown ?category= is ignored rather than producing an empty page for a
  // filter the user never chose.
  const active = CONTENT_CATEGORIES.includes(category as ContentCategory)
    ? (category as ContentCategory)
    : undefined;

  const shown = active ? all.filter((r) => r.category === active) : all;
  const featured = active ? undefined : featuredReport();
  const grid = featured ? shown.filter((r) => r.slug !== featured.slug) : shown;

  return (
    <div className="min-h-screen bg-oled text-textPrimary">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Research", path: "/reports" },
        ])}
      />

      <main className="section pb-24 pt-14">
        <ContentHero
          eyebrow="FurlPay Research"
          title="Research for the new financial system"
          lead="Money is being rebuilt on new rails, and most of what is written about it is either marketing or speculation. We publish what we can evidence — on stablecoins, cross-border payments, banking infrastructure and the institutions adapting to them."
        />

        <p className="mt-8 flex flex-wrap gap-x-2 gap-y-1 text-[13px] text-textMuted">
          {AREAS.map((a, i) => (
            <span key={a}>
              {a}
              {i < AREAS.length - 1 && <span className="ml-2 text-white/20">·</span>}
            </span>
          ))}
        </p>

        {categories.length > 1 && (
          <div className="mt-10">
            <CategoryFilter categories={categories} active={active} basePath="/reports" />
          </div>
        )}

        {all.length === 0 ? (
          <div className="mt-12">
            {/* The honest state today: FurlPay has not published research yet,
                and a research portal must not invent a report to look busy. */}
            <EmptyState
              title="No research published yet"
              body="FurlPay research is in preparation. In the meantime, the engineering and product writing on the blog covers much of the same ground."
              action={{ label: "Read the blog", href: "/blog" }}
            />
          </div>
        ) : (
          <>
            {featured && (
              <section aria-labelledby="featured-report" className="mt-12">
                <h2 id="featured-report" className="sr-only">
                  Featured report
                </h2>
                <div className="max-w-sm">
                  <ContentCard item={reportSummary(featured)} priority />
                </div>
              </section>
            )}

            {grid.length > 0 && (
              <section aria-labelledby="all-reports" className="mt-14">
                <div className="flex items-baseline justify-between border-b border-white/10 pb-4">
                  <h2 id="all-reports" className="text-[22px] font-bold tracking-tight">
                    {active ? active : "Latest research"}
                  </h2>
                  <span className="text-[13px] text-textMuted">
                    {grid.length} {grid.length === 1 ? "report" : "reports"}
                  </span>
                </div>
                <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {grid.map((r) => (
                    <ContentCard key={r.slug} item={reportSummary(r)} />
                  ))}
                </div>
              </section>
            )}

            {shown.length === 0 && active && (
              <div className="mt-12">
                <EmptyState
                  title={`No research in ${active} yet`}
                  body="Nothing published under this category so far."
                  action={{ label: "See all research", href: "/reports" }}
                />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
