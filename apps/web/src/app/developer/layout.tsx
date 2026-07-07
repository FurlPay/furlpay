import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Developer Platform — Furlpay",
    template: "%s — Furlpay Developers",
  },
  description:
    "Build on Furlpay: stablecoin payments, x402 agentic APIs, signed webhooks and SDKs. Create API keys and go live in minutes.",
  alternates: { canonical: "/developer" },
  openGraph: {
    type: "website",
    url: "https://furlpay.com/developer",
    siteName: "Furlpay",
    title: "Furlpay Developer Platform",
    description:
      "Stablecoin payments, x402 agentic APIs, signed webhooks and SDKs. Create API keys and go live in minutes.",
    images: [{ url: "/og.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Furlpay Developer Platform",
    description: "Stablecoin payments, x402 agentic APIs, webhooks and SDKs.",
    images: ["/og.png"],
  },
};

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  return children;
}
