import { seoMetadata } from "@/lib/seo/meta";

export const metadata = seoMetadata({
  title: "Restaurant Reservations",
  description: "Reserve and pay at restaurants with USDC and crypto, earning 2% cashback on dining while you travel.",
  path: "/travel/restaurants",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
