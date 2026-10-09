import { seoMetadata } from "@/lib/seo/meta";

export const metadata = seoMetadata({
  title: "Tours & Activities",
  description: "Tours, attractions and experiences you can pay for with USDC or crypto, listed only when a supplier can actually sell them.",
  path: "/travel/activities",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
