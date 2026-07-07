import { seoMetadata } from "@/lib/seo/meta";

export const metadata = seoMetadata({
  title: "Refer & Earn USDC",
  description: "Refer friends to FurlPay Travels and earn USDC when they book. Weekly on-chain payouts, no minimum.",
  path: "/travel/refer",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
