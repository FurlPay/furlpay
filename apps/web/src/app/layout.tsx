import type { Metadata, Viewport } from "next";
import "./globals.css";
import Shell from "@/components/Shell";

const SITE = "https://furlpay.com";
const TITLE = "Furlpay — The On-Chain Financial Operating System";
const DESCRIPTION =
  "Fusing stablecoin payments, global local accounts, and fractional stock investing into one beautiful web & desktop client. Phishing-resistant. Compliance-aware. Zero gas.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: TITLE, template: "%s — Furlpay" },
  description: DESCRIPTION,
  keywords: [
    "stablecoin payments",
    "USDC",
    "agentic payments",
    "x402",
    "solana actions",
    "passkeys",
    "virtual cards",
    "fractional investing",
    "MiCA",
    "account abstraction",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE,
    siteName: "Furlpay",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/og.png", width: 1024, height: 374, alt: "Furlpay" }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@furlpay",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
  robots: { index: true, follow: true },
};

// Organization + WebSite structured data for rich results.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE}/#org`,
      name: "Furlpay",
      url: SITE,
      logo: `${SITE}/furlpay-mark.svg`,
      email: "hello@furlpay.com",
      sameAs: [
        "https://github.com/FurlPay",
        "https://x.com/furlpay",
        "https://instagram.com/furlpay",
      ],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE}/#site`,
      url: SITE,
      name: "Furlpay",
      publisher: { "@id": `${SITE}/#org` },
    },
  ],
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        {/* Shell picks full-bleed (marketing/docs) vs phone-frame app chrome. */}
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
