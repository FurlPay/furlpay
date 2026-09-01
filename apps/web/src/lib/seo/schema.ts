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

/**
 * A lodging property, for local search rich results.
 *
 * EVERY OPTIONAL FIELD IS GENUINELY OPTIONAL, and that is the whole design.
 * Structured data is a machine-readable assertion to Google about a real
 * business, so a field that is guessed is worse here than anywhere else in the
 * product: it is a false statement made to a search engine, at scale, in a
 * format built to be trusted. This dataset has ratings on 80% of properties,
 * websites on 59% and summaries on 33%, so a builder that required them would
 * force exactly that invention.
 *
 * `aggregateRating` in particular is emitted ONLY with a real review count.
 * Schema.org requires reviewCount or ratingCount on AggregateRating, and
 * Google's rich-results guidance treats a rating without a count as invalid —
 * so an inferred count would be both a lie and a markup error.
 *
 * No `priceRange`. Google's priceLevel is populated on 29 of 16,014 records
 * and is a 1-4 bucket, not a currency range; mapping it to "$$" would be a
 * guess dressed as a fact. It returns when a real rate provider does.
 */
export function lodgingBusiness(p: {
  name: string;
  url: string;
  latitude: number;
  longitude: number;
  /** Free-text address as held. Structured PostalAddress needs parsed parts
   *  we do not reliably have, and a wrongly-parsed address is worse than a
   *  correct string. */
  address?: string | null;
  city?: string | null;
  country?: string | null;
  description?: string | null;
  telephone?: string | null;
  image?: string | null;
  /** Google's rating. Emitted only alongside a real review count. */
  rating?: number | null;
  reviewCount?: number | null;
  /** Official star classification, when a body actually awarded one. */
  starRating?: number | null;
  sameAs?: string | null;
}) {
  const hasRating =
    typeof p.rating === "number" && typeof p.reviewCount === "number" && p.reviewCount > 0;

  return {
    "@context": "https://schema.org",
    "@type": "LodgingBusiness",
    name: p.name,
    url: p.url,
    geo: {
      "@type": "GeoCoordinates",
      latitude: p.latitude,
      longitude: p.longitude,
    },
    ...(p.address || p.city || p.country
      ? {
          address: {
            "@type": "PostalAddress",
            ...(p.address ? { streetAddress: p.address } : {}),
            ...(p.city ? { addressLocality: p.city } : {}),
            ...(p.country ? { addressCountry: p.country } : {}),
          },
        }
      : {}),
    ...(p.description ? { description: p.description } : {}),
    ...(p.telephone ? { telephone: p.telephone } : {}),
    ...(p.image ? { image: p.image } : {}),
    ...(typeof p.starRating === "number"
      ? { starRating: { "@type": "Rating", ratingValue: p.starRating } }
      : {}),
    ...(hasRating
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: p.rating,
            reviewCount: p.reviewCount,
          },
        }
      : {}),
    ...(p.sameAs ? { sameAs: p.sameAs } : {}),
  };
}

/**
 * A destination, for "hotels in <city>" style queries.
 *
 * Takes a real property count rather than a blurb. A TouristDestination that
 * claims coverage it does not have is the structured-data version of the
 * "1,240+ Hotels" problem, and Google is a worse audience for it than a
 * reader — a reader can click through and see, Google indexes the claim.
 */
export function touristDestination(p: {
  name: string;
  url: string;
  description: string;
  latitude?: number | null;
  longitude?: number | null;
  country?: string | null;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "TouristDestination",
    name: p.name,
    url: p.url,
    description: p.description,
    ...(typeof p.latitude === "number" && typeof p.longitude === "number"
      ? { geo: { "@type": "GeoCoordinates", latitude: p.latitude, longitude: p.longitude } }
      : {}),
    ...(p.country
      ? { address: { "@type": "PostalAddress", addressCountry: p.country } }
      : {}),
  };
}

/**
 * A service offered in a place.
 *
 * For the /hotels/<city> pages, which are about FurlPay's payment service in
 * that city and — importantly — do NOT list any hotels. An SEO audit asked for
 * LodgingBusiness markup there; that would have described properties the page
 * never renders, and Google's structured-data policy requires markup to
 * describe content visible on the page. Marking up absent content is a
 * penalty, not a ranking signal.
 *
 * `areaServed` carries the city, which is the local signal the page can
 * honestly make.
 */
export function service(p: {
  name: string;
  description: string;
  url: string;
  serviceType: string;
  areaServed: string;
  country?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: p.name,
    description: p.description,
    url: p.url,
    serviceType: p.serviceType,
    provider: { "@id": ORG_ID },
    areaServed: {
      "@type": "City",
      name: p.areaServed,
      ...(p.country
        ? { address: { "@type": "PostalAddress", addressCountry: p.country } }
        : {}),
    },
  };
}
