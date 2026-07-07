import { seoMetadata } from "@/lib/seo/meta";

export const metadata = seoMetadata({
  title: "Webhooks",
  description: "Subscribe to Furlpay events with signed webhooks, and verify the signature before trusting a payload.",
  path: "/developer/webhooks",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
