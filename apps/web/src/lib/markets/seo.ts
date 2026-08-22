import type { MergedAsset } from "./universe";
import type { RealStats } from "./providers";

// ---------------------------------------------------------------------------
// The SEO layer for /markets/[symbol]. One implementation, ~13,000 pages.
//
// Every string here is composed from data the page actually holds. Nothing is
// templated around a value that might be null: a description promising
// "earnings, valuation and analyst estimates" on a symbol with no filings is a
// claim the page cannot honour, and it is the kind of thin, auto-generated copy
// that gets a whole subdirectory demoted rather than ranked.
//
// So the rule throughout: a fact appears in the metadata only when it exists.
// The sentences get shorter for obscure tickers, which is correct — those pages
// genuinely have less to say.
// ---------------------------------------------------------------------------

export const SITE = "https://furlpay.com";

/** Exchange as it should read in a title: "NASDAQ: MU". Null when unknown. */
export function exchangeLabel(asset: MergedAsset): string | null {
  if (asset.kind === "crypto") return null;
  const ex = asset.exchange?.trim();
  if (!ex) return null;
  // Alpaca reports ARCA/BATS for listed ETFs; neither is how a reader refers to
  // the listing, and "ARCA: SPY" in a title looks like a typo.
  if (ex === "ARCA" || ex === "BATS") return "NYSE Arca";
  return ex;
}

/** "Micron Technology (NASDAQ: MU)" — the entity, spelled the way a search
 *  result should show it. */
export function entityLabel(asset: MergedAsset): string {
  const ex = exchangeLabel(asset);
  return ex ? `${asset.name} (${ex}: ${asset.symbol})` : `${asset.name} (${asset.symbol})`;
}

/** The single H1. One per page, and the same shape for every security. */
export function pageH1(asset: MergedAsset): string {
  const noun = asset.kind === "crypto" ? "Price" : "Stock Price";
  return `${asset.name} (${asset.symbol}) ${noun}`;
}

export function canonicalPath(symbol: string): string {
  return `/markets/${symbol.toUpperCase()}`;
}

/**
 * Title. Kept under ~60 characters where the company name allows, because
 * Google truncates beyond that and a truncated title loses the brand.
 */
export function pageTitle(asset: MergedAsset): string {
  const kind = asset.kind === "crypto" ? "Price & Chart" : "Stock Price & Quote";
  return `${asset.symbol} ${kind} | ${asset.name} | FurlPay`;
}

/**
 * Description, assembled from what this symbol actually has.
 *
 * The section list is filtered against the stats object rather than fixed, so a
 * symbol with no SEC filings does not advertise financials it cannot show.
 */
export function pageDescription(asset: MergedAsset, stats: RealStats | null): string {
  const subject = entityLabel(asset);
  const has = (v: unknown) => v !== null && v !== undefined;

  const sections: string[] = [];
  if (has(stats?.price)) sections.push("live price");
  sections.push("charts");
  if (has(stats?.high52w)) sections.push("52-week range");
  if (has(stats?.marketCap) || has(stats?.peRatio)) sections.push("valuation");
  if (has(stats?.revenueTtm) || has(stats?.epsTtm)) sections.push("financials from SEC filings");
  if (has(stats?.dividendYieldPct)) sections.push("dividend history");

  const list =
    sections.length > 1
      ? `${sections.slice(0, -1).join(", ")} and ${sections[sections.length - 1]}`
      : sections[0];

  return `${subject} — ${list}. Every figure is sourced and timestamped on FurlPay Markets.`;
}

/**
 * A factual company sentence built ONLY from fields the catalog holds.
 *
 * There is no licensed company-description source in this codebase, and an
 * LLM-written paragraph about a company's business would be exactly the
 * fabricated content the rest of this module exists to avoid. So this states
 * what is known — listing, sector, industry, size — and nothing more.
 */
export function overviewSentence(asset: MergedAsset, stats: RealStats | null): string {
  const ex = exchangeLabel(asset);
  const parts: string[] = [];

  if (asset.kind === "crypto") {
    parts.push(`${asset.name} (${asset.symbol}) is a digital asset tracked on FurlPay Markets`);
  } else {
    parts.push(
      ex
        ? `${asset.name} trades on ${ex} under the ticker ${asset.symbol}`
        : `${asset.name} trades under the ticker ${asset.symbol}`
    );
  }

  if (asset.sector && asset.industry && asset.sector !== asset.industry) {
    parts.push(`It is classified in the ${asset.sector} sector, ${asset.industry} industry`);
  } else if (asset.sector) {
    parts.push(`It is classified in the ${asset.sector} sector`);
  }

  if (stats?.marketCap != null) {
    parts.push(`Its market capitalisation is ${compactUsd(stats.marketCap)}`);
  }

  return parts.join(". ") + ".";
}

function compactUsd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)} trillion`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)} billion`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)} million`;
  return `$${n.toLocaleString("en-US")}`;
}

// ---------------------------------------------------------------------------
// FAQ
//
// Only questions this page can answer from data it holds. An FAQPage whose
// answers are "data unavailable" is worse than no FAQ: the structured data
// promises an answer the visible page does not give, which is precisely the
// mismatch Google's structured-data policy treats as spam.
// ---------------------------------------------------------------------------

export interface FaqEntry {
  question: string;
  answer: string;
}

export function buildFaq(asset: MergedAsset, stats: RealStats | null): FaqEntry[] {
  const faq: FaqEntry[] = [];
  const ex = exchangeLabel(asset);
  const isStock = asset.kind !== "crypto";

  if (stats?.price != null) {
    faq.push({
      question: `What is the ${asset.symbol} ${isStock ? "stock " : ""}price today?`,
      answer: `${asset.name} (${asset.symbol}) last traded at $${stats.price.toFixed(2)}${
        stats.changePct != null
          ? `, ${stats.changePct >= 0 ? "up" : "down"} ${Math.abs(stats.changePct).toFixed(2)}% on the session`
          : ""
      }. FurlPay quotes ${asset.symbol} from Yahoo Finance and stamps each figure with the exchange time it printed.`,
    });
  }

  if (isStock && ex) {
    faq.push({
      question: `What exchange is ${asset.symbol} listed on?`,
      answer: `${asset.name} is listed on ${ex} under the ticker symbol ${asset.symbol}.`,
    });
  }

  if (stats?.marketCap != null) {
    faq.push({
      question: `What is ${asset.name}'s market cap?`,
      answer: `${asset.name} has a market capitalisation of ${compactUsd(
        stats.marketCap
      )}, derived from its shares outstanding as reported in its SEC filings and the latest quoted price.`,
    });
  }

  if (stats?.peRatio != null && stats.epsTtm != null) {
    faq.push({
      question: `What is ${asset.symbol}'s P/E ratio?`,
      answer: `${asset.symbol} trades at a price-to-earnings ratio of ${stats.peRatio.toFixed(
        2
      )}, based on trailing twelve-month earnings per share of $${stats.epsTtm.toFixed(2)} taken from ${
        asset.name
      }'s own SEC filings.`,
    });
  }

  if (stats?.high52w != null && stats.low52w != null) {
    faq.push({
      question: `What is ${asset.symbol}'s 52-week range?`,
      answer: `Over the past 52 weeks ${asset.symbol} has traded between $${stats.low52w.toFixed(
        2
      )} and $${stats.high52w.toFixed(2)}.`,
    });
  }

  if (stats?.dividendYieldPct != null) {
    faq.push({
      question: `Does ${asset.name} pay a dividend?`,
      answer: `Yes. ${asset.name} carries a dividend yield of ${stats.dividendYieldPct.toFixed(2)}%${
        stats.dividendPerShareTtm != null
          ? `, or $${stats.dividendPerShareTtm.toFixed(2)} per share over the trailing twelve months`
          : ""
      }.`,
    });
  }

  if (asset.sector) {
    faq.push({
      question: `What sector is ${asset.name} in?`,
      answer: `${asset.name} is classified in the ${asset.sector} sector${
        asset.industry && asset.industry !== asset.sector ? `, ${asset.industry} industry` : ""
      }.`,
    });
  }

  return faq;
}

// ---------------------------------------------------------------------------
// JSON-LD
//
// Deliberately NOT Product/Offer. Google's Product schema describes something
// for sale at a price a merchant sets; a listed security is neither, and using
// it to farm a price rich-result is a misrepresentation of the page. The types
// below are the ones that honestly describe what this page is.
// ---------------------------------------------------------------------------

export function breadcrumbJsonLd(asset: MergedAsset) {
  const trail = [
    { name: "Home", item: SITE },
    { name: "Markets", item: `${SITE}/markets` },
    { name: asset.name, item: `${SITE}${canonicalPath(asset.symbol)}` },
  ];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      item: t.item,
    })),
  };
}

/**
 * The company as an entity, so the ticker and the legal name resolve to the
 * same thing in Google's knowledge graph.
 *
 * `tickerSymbol` is schema.org/Corporation's own property, and the SEC CIK goes
 * in `identifier` — a stable, official identifier is the strongest signal
 * available here that MU is Micron Technology and not something else.
 */
export function companyJsonLd(asset: MergedAsset, stats: RealStats | null) {
  if (asset.kind === "crypto") return null;

  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Corporation",
    name: asset.name,
    tickerSymbol: asset.symbol,
    url: `${SITE}${canonicalPath(asset.symbol)}`,
  };

  const ex = exchangeLabel(asset);
  if (ex) node.exchange = ex;
  if (asset.industry) node.industry = asset.industry;

  const cik = stats?.provenance?.cik;
  if (cik) {
    node.identifier = { "@type": "PropertyValue", propertyID: "SEC CIK", value: cik };
    node.sameAs = [`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}`];
  }

  return node;
}

export function faqJsonLd(faq: FaqEntry[]) {
  if (faq.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
}

// ---------------------------------------------------------------------------
// Sitemap selection
// ---------------------------------------------------------------------------

/**
 * Warrants, units and preferred series. These resolve and render, but a SPAC
 * warrant files no income statement and has no market cap, so its page is a
 * name and a thin quote — the definition of the mass-produced thin page that
 * gets a whole subdirectory discounted.
 *
 * They stay reachable and crawlable; they are simply not *submitted*. Class
 * shares (BRK.B, BF.A) are kept: those are ordinary equity with full filings.
 */
function isThinInstrument(symbol: string): boolean {
  const dot = symbol.indexOf(".");
  if (dot === -1) return false;
  const suffix = symbol.slice(dot + 1).toUpperCase();
  return suffix.startsWith("W") || suffix.startsWith("U") || suffix.startsWith("PR");
}

/**
 * The tickers worth submitting to Google, newest-listing order irrelevant.
 *
 * Curated assets always qualify — they carry a hand-written sector, a logo and
 * peers, so their pages are substantive by construction. Everything else has to
 * at least be an ordinary instrument.
 */
export function sitemapSymbols(
  all: { symbol: string; curated: boolean }[]
): { symbol: string; curated: boolean }[] {
  const seen = new Set<string>();
  const out: { symbol: string; curated: boolean }[] = [];
  for (const a of all) {
    const sym = a.symbol.toUpperCase();
    if (seen.has(sym)) continue;
    if (!a.curated && isThinInstrument(sym)) continue;
    seen.add(sym);
    out.push({ symbol: sym, curated: a.curated });
  }
  return out;
}
