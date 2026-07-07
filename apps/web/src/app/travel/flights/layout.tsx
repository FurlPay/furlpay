import { seoMetadata } from "@/lib/seo/meta";

export const metadata = seoMetadata({
  title: "Crypto Flights",
  description: "Book flights and pay with USDC, SOL, BTC or 100+ cryptos. Live fares from 300+ airlines, 2% cashback, and a 15-minute rate lock at checkout.",
  path: "/travel/flights",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
