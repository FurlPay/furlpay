import { seoMetadata } from "@/lib/seo/meta";

export const metadata = seoMetadata({
  title: "Crypto Travel Deals",
  description: "Discounted travel rates, shown only when a provider publishes both the regular and the discounted price. Pay in USDC or crypto.",
  path: "/travel/deals",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
