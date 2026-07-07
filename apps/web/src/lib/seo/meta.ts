import type { Metadata } from "next";

// ---------------------------------------------------------------------------
// One place to build page metadata so every marketing/SEO page ships a
// canonical URL, Open Graph, and Twitter card — not just a <title>. Page-level
// OG/Twitter give search + social + AI-preview surfaces a specific card instead
// of the generic site default, which lifts click-through (a ranking input).
// ---------------------------------------------------------------------------

const SITE = "https://furlpay.com";

export function seoMetadata(p: {
  /** Page title. Nearest layout's title template (e.g. "%s — Furlpay") still applies to the <title>. */
  title: string;
  description: string;
  /** Canonical path, e.g. "/travel/flights". */
  path: string;
  /** OG/Twitter image path. Defaults to the site card. */
  image?: string;
  /** Full title for OG/Twitter cards (no template). Defaults to `title`. */
  ogTitle?: string;
}): Metadata {
  const url = `${SITE}${p.path}`;
  const image = p.image ?? "/og.png";
  const ogTitle = p.ogTitle ?? p.title;
  return {
    title: p.title,
    description: p.description,
    alternates: { canonical: p.path },
    openGraph: {
      type: "website",
      url,
      siteName: "Furlpay",
      title: ogTitle,
      description: p.description,
      images: [{ url: image }],
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description: p.description,
      images: [image],
    },
  };
}
