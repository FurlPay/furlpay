import { seoMetadata } from "@/lib/seo/meta";

export const metadata = seoMetadata({
  title: "Crypto Hotel Stays",
  description: "Book from hotels and stays and pay with USDC and 100+ cryptocurrencies. On-chain receipts, 2% cashback, and no bank account required.",
  path: "/travel/stays",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
