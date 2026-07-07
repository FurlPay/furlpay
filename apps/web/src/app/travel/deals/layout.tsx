import { seoMetadata } from "@/lib/seo/meta";

export const metadata = seoMetadata({
  title: "Crypto Travel Deals",
  description: "Live deals on flights, hotels and experiences — pay in USDC and earn 2% cashback on every booking, settled on-chain.",
  path: "/travel/deals",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
