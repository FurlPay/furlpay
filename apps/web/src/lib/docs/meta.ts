import type { Metadata } from "next";
import { DOC_ORDER } from "@/lib/docs/nav";

// Per-page SEO metadata for docs, derived from the nav config (single source
// of truth shared with the sidebar and /llms.txt). Root layout sets
// metadataBase, so relative URLs resolve to the production origin.

export function docMeta(path: string): Metadata {
  const doc = DOC_ORDER.find((d) => d.href === path);
  if (!doc) throw new Error(`docMeta: ${path} is not in DOCS_NAV`);
  const title = `${doc.title} — Furlpay Docs`;
  return {
    title,
    description: doc.desc,
    alternates: { canonical: path },
    openGraph: {
      title,
      description: doc.desc,
      url: path,
      type: "article",
      siteName: "Furlpay",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: doc.desc,
    },
  };
}
