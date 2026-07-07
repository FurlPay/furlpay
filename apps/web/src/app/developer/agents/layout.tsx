import { seoMetadata } from "@/lib/seo/meta";

export const metadata = seoMetadata({
  title: "Agent Console",
  description: "Give AI agents a wallet: x402 pay-per-call, spend mandates and the live Agent Console demo.",
  path: "/developer/agents",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
