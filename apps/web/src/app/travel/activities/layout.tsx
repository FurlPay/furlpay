import { seoMetadata } from "@/lib/seo/meta";

export const metadata = seoMetadata({
  title: "Tours & Activities",
  description: "Book tours, attractions and experiences worldwide and pay with USDC or 100+ cryptos, with 2% cashback on every booking.",
  path: "/travel/activities",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
