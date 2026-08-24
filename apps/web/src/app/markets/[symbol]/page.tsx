import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import JsonLd from "@/components/JsonLd";
import SeoSections from "@/components/markets/SeoSections";
import { CATALOG } from "@/lib/markets/catalog";
import { realStatsFor, type RealStats } from "@/lib/markets/providers";
import { resolveAsset } from "@/lib/markets/resolve";
import { bySymbol } from "@/lib/markets/catalog";
import type { MergedAsset } from "@/lib/markets/universe";
import {
  breadcrumbJsonLd,
  buildFaq,
  buildHowToBuyFaq,
  canonicalPath,
  companyJsonLd,
  datasetJsonLd,
  faqJsonLd,
  investmentJsonLd,
  pageDescription,
  pageTitle,
} from "@/lib/markets/seo";
import StockClient from "./StockClient";

// Server shell for /markets/[symbol].
//
// The page used to be a single client component. That meant ~13,000 ticker
// pages served a spinner and a generic homepage <title> to crawlers, with the
// company name, the price and every statistic arriving only after hydration.
// The interactive parts still run on the client — a chart and an order ticket
// have to — but everything a search engine should read is rendered here.
//
// ISR rather than force-dynamic: fundamentals move once a quarter and the
// quote on this server pass is a starting value the client refreshes anyway,
// so a five-minute shared cache costs nothing in accuracy and takes the page
// off a cold render for every crawl.
export const revalidate = 300;

/**
 * Fetch once per request and reuse for metadata + body.
 *
 * Wrapped in React's `cache` because Next only de-duplicates `fetch()`, and
 * neither of these is one: `resolveAsset` reads an in-process map and
 * `realStatsFor` goes through Redis. Without the memo, generateMetadata and the
 * page component each ran the whole chain — two Redis round trips on a good
 * day, and two live hits on Yahoo and SEC EDGAR whenever Redis was unreachable,
 * which is exactly when the upstreams can least afford the extra traffic.
 */
const load = cache(async function load(
  rawSymbol: string
): Promise<{ asset: MergedAsset; stats: RealStats | null } | null> {
  const symbol = decodeURIComponent(rawSymbol).toUpperCase();
  const asset = await resolveAsset(symbol);
  if (!asset) return null;
  const stats = await realStatsFor(symbol, asset.kind, bySymbol.get(symbol)?.cg ?? null).catch(
    () => null
  );
  return { asset, stats };
});

export async function generateMetadata(props: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol } = await props.params;
  const loaded = await load(symbol);

  // An unknown ticker gets no indexable metadata. It 404s below, and a 404 that
  // still advertises a title is how soft-404s get indexed.
  if (!loaded) {
    return { title: "Asset not found | FurlPay", robots: { index: false, follow: false } };
  }

  const { asset, stats } = loaded;
  const title = pageTitle(asset);
  const description = pageDescription(asset, stats);
  const path = canonicalPath(asset.symbol);

  return {
    // `absolute` bypasses the root layout's "%s — Furlpay" template. Without it
    // the tag renders "... | FurlPay — Furlpay", which wastes the ~60 characters
    // Google shows on the brand, twice.
    title: { absolute: title },
    description,
    // Without this the page inherits `canonical: "/"` from the root layout and
    // declares itself a duplicate of the homepage — which is what every ticker
    // page did before this file existed.
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url: `https://furlpay.com${path}`,
      siteName: "Furlpay",
      title: `${asset.name} (${asset.symbol}) — Stock Price & Market Data`,
      description,
      images: [{ url: "/og.png" }],
    },
    twitter: {
      card: "summary_large_image",
      site: "@furlpayglobal",
      title: `${asset.name} (${asset.symbol}) — Stock Price & Market Data`,
      description,
      images: ["/og.png"],
    },
  };
}

/**
 * Peers for the internal-link graph.
 *
 * Sector match against the curated catalog, because that is the only place with
 * hand-checked sector data. An uncurated symbol has no sector and therefore no
 * peers — better than linking it to every other company whose sector is also
 * null, which is what an equality test on `null === null` would have done.
 */
function relatedFor(asset: MergedAsset): { symbol: string; name: string }[] {
  if (!asset.sector) return [];
  return CATALOG.filter(
    (a) => a.symbol !== asset.symbol && a.kind === asset.kind && a.sector === asset.sector
  )
    .slice(0, 8)
    .map((a) => ({ symbol: a.symbol, name: a.name }));
}

export default async function Page(props: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await props.params;
  const loaded = await load(symbol);
  if (!loaded) notFound();

  const { asset, stats } = loaded;
  // Composed exactly as SeoSections composes it, so the FAQPage graph and the
  // visible <dl> can never describe different questions.
  const faq = [...buildFaq(asset, stats), ...buildHowToBuyFaq(asset)];
  const company = companyJsonLd(asset, stats);
  const investment = investmentJsonLd(asset, stats);
  const dataset = datasetJsonLd(asset, stats);
  const faqLd = faqJsonLd(faq);

  return (
    <>
      {/* Structured data describes only what the body below actually renders:
          the breadcrumb trail, the company entity, the instrument and its
          price, the statistics tables as a dataset, and the FAQ — each emitted
          only when the corresponding content is genuinely on the page. */}
      <JsonLd data={breadcrumbJsonLd(asset)} />
      {company && <JsonLd data={company} />}
      {investment && <JsonLd data={investment} />}
      {dataset && <JsonLd data={dataset} />}
      {faqLd && <JsonLd data={faqLd} />}

      <StockClient symbol={asset.symbol}>
        <SeoSections asset={asset} stats={stats} related={relatedFor(asset)} />
      </StockClient>
    </>
  );
}
