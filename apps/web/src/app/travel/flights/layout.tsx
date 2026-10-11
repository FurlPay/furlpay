import { seoMetadata } from "@/lib/seo/meta";

export const metadata = seoMetadata({
  title: "Crypto Flights",
  description: "Search flights and pay with USDC, SOL, BTC or other crypto. Only fares an airline actually quoted are shown, with a 15-minute checkout quote.",
  path: "/travel/flights",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
