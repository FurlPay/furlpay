import { seoMetadata } from "@/lib/seo/meta";

export const metadata = seoMetadata({
  title: "Crypto Hotel Stays",
  description: "Search hotels and stays and pay with USDC or crypto. Rates are shown only when a provider quotes them, and checkout re-prices on the server.",
  path: "/travel/stays",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
