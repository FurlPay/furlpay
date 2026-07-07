import { seoMetadata } from "@/lib/seo/meta";

export const metadata = seoMetadata({
  title: "Car Rentals with Crypto",
  description: "Rent a car anywhere and pay with USDC or crypto. Transparent pricing, 2% cashback, and a single-use virtual card for any rental desk.",
  path: "/travel/car-rentals",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
