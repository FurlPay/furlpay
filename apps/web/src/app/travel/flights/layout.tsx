import { seoMetadata } from "@/lib/seo/meta";

export const metadata = seoMetadata({
  title: "Crypto Flights",
  description: "Book flights and pay with USDC, SOL, BTC or 100+ cryptos. Fares from our airline partner where available, 2% cashback, and a 15-minute checkout quote.",
  path: "/travel/flights",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
