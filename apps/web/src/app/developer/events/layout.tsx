import { seoMetadata } from "@/lib/seo/meta";

export const metadata = seoMetadata({
  title: "Event Stream",
  description: "Browse the Furlpay event types your webhooks can subscribe to.",
  path: "/developer/events",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
