import { seoMetadata } from "@/lib/seo/meta";

export const metadata = seoMetadata({
  title: "Travel Gift Cards",
  description: "Buy travel gift cards with USDC and crypto — brand cards for flights, hotels and experiences, coming soon: not available yet.",
  path: "/travel/gift-cards",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
