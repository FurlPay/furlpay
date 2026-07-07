import { seoMetadata } from "@/lib/seo/meta";

export const metadata = seoMetadata({
  title: "API Keys",
  description: "Create and manage Furlpay API keys for payments, travel and x402 agentic calls.",
  path: "/developer/keys",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
