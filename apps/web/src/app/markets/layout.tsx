import type { Metadata } from "next";

// Metadata for the Markets subtree.
//
// The index and the list pages are client components, which cannot export
// `metadata` themselves — so without this they inherited the ROOT layout's
// title and description and announced themselves as the FurlPay homepage.
//
// Deliberately NO `alternates.canonical` here. A canonical set on a layout
// applies to every page beneath it, which would point /markets/chains and
// /markets/collections/* at /markets and tell Google they are duplicates. With
// the root layout no longer asserting one either, a page without an explicit
// canonical now self-canonicalises, which is the correct behaviour for all
// three. /markets/[symbol] sets its own in generateMetadata and overrides this
// whole block.
export const metadata: Metadata = {
  title: "Markets — Stocks, ETFs & Crypto",
  description:
    "Search and track roughly 13,000 US-listed stocks and ETFs plus major crypto. Live prices, charts, and financials drawn from SEC filings on FurlPay Markets.",
};

export default function MarketsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
