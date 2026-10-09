import { seoMetadata } from "@/lib/seo/meta";

export const metadata = seoMetadata({
  title: "Car Rentals with Crypto",
  description: "Search rental cars and pay with USDC or crypto. Cars and prices are shown only when a rental provider quotes them.",
  path: "/travel/car-rentals",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
