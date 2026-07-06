// ---------------------------------------------------------------------------
// Reusable JSON-LD builders. Google's 2026 ranking leans on structured data:
// rich results, and — for AI Overviews / GEO — machine-readable facts it can
// cite. Every marketing/blog/tool page emits one or more of these graphs via
// the <JsonLd> component. The Organization node lives in the root layout under
// the `#org` id, so nodes here reference it rather than redefining it.
// ---------------------------------------------------------------------------

export const SITE = "https://furlpay.com";
export const ORG_ID = `${SITE}/#org`;

/** A financial/payment product page (e.g. the USDC gateway, x402). */
export function financialProduct(p: {
  name: string;
  description: string;
  url: string;
  fees?: string; // e.g. "0.5% per transaction"
  serviceUrl?: string; // where the product is consumed (docs / app)
  category?: string; // e.g. "Payment gateway"
}) {
  return {
    "@context": "https://schema.org",
    "@type": "FinancialProduct",
    name: p.name,
    description: p.description,
    url: p.url,
    category: p.category,
    provider: { "@id": ORG_ID },
    ...(p.fees ? { feesAndCommissionsSpecification: p.fees } : {}),
    ...(p.serviceUrl
      ? { availableChannel: { "@type": "ServiceChannel", serviceUrl: p.serviceUrl } }
      : {}),
  };
}

/** FAQ block — the single highest-yield schema for AI Overview citations. */
export function faqPage(items: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}

/** Breadcrumb trail. `items` are ordered root → current; last is the page. */
export function breadcrumb(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `${SITE}${it.path}`,
    })),
  };
}

/** An editorial article (blog / guide). Pairs with the BlogPosting on posts. */
export function article(p: {
  headline: string;
  description: string;
  url: string;
  datePublished: string;
  dateModified?: string;
  author?: string;
  image?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: p.headline,
    description: p.description,
    datePublished: p.datePublished,
    dateModified: p.dateModified ?? p.datePublished,
    author: { "@type": "Organization", name: p.author ?? "Furlpay", url: SITE },
    publisher: { "@id": ORG_ID },
    mainEntityOfPage: p.url,
    ...(p.image ? { image: p.image } : {}),
  };
}

/** Step-by-step guide (quickstarts, tutorials). Eligible for HowTo rich results. */
export function howTo(p: {
  name: string;
  description: string;
  steps: { name: string; text: string }[];
  totalTime?: string; // ISO 8601 duration, e.g. "PT5M"
}) {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: p.name,
    description: p.description,
    ...(p.totalTime ? { totalTime: p.totalTime } : {}),
    step: p.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
}

/** Interactive tool / calculator page. */
export function webApplication(p: {
  name: string;
  description: string;
  url: string;
  category?: string; // e.g. "FinanceApplication"
}) {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: p.name,
    description: p.description,
    url: p.url,
    applicationCategory: p.category ?? "FinanceApplication",
    operatingSystem: "Web",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@id": ORG_ID },
  };
}
