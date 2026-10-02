import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LandingChrome from "@/components/landing/LandingChrome";
import JsonLd from "@/components/JsonLd";
import { ContentHero } from "@/components/content/ContentShell";
import ResearchLibrary, { sanitizeFilters } from "@/components/content/ResearchLibrary";
import { seoMetadata } from "@/lib/seo/meta";
import { breadcrumb } from "@/lib/seo/schema";
import { RESEARCH_DESKS } from "@/lib/content";

type Params = Promise<{ desk: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

// The six desks are the complete set: any other slug is a real 404, not a
// rendered "not found" with a 200 (the soft-404 the SEO audit flagged).
export const dynamicParams = false;
export function generateStaticParams() {
  return RESEARCH_DESKS.map((d) => ({ desk: d.slug }));
}

const deskOf = (slug: string) => RESEARCH_DESKS.find((d) => d.slug === slug);

export async function generateMetadata(props: { params: Params; searchParams: SP }): Promise<Metadata> {
  const d = deskOf((await props.params).desk);
  if (!d) return {};
  const base = seoMetadata({ title: `${d.title} — Research`, description: d.blurb, path: `/research/${d.slug}`, ogTitle: `${d.title} · FurlPay Research` });
  const f = sanitizeFilters(await props.searchParams);
  return f.cadence || f.year || f.q ? { ...base, robots: { index: false, follow: true } } : base;
}

export default async function DeskPage(props: { params: Params; searchParams: SP }) {
  const d = deskOf((await props.params).desk);
  if (!d) notFound();
  const filters = sanitizeFilters(await props.searchParams);
  return (
    <div className="min-h-screen bg-oled text-textPrimary">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Research", path: "/research" },
          { name: d.title, path: `/research/${d.slug}` },
        ])}
      />
      <main className="section pb-24 pt-14">
        <ContentHero eyebrow="FurlPay Research" title={d.title} lead={d.blurb} />
        <ResearchLibrary base={`/research/${d.slug}`} filters={filters} lockedDesk={d.slug} />
      </main>
    </div>
  );
}
