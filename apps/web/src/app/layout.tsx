import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import Shell from "@/components/Shell";
import ConsentManager from "@/components/ConsentManager";

// Search-console / analytics ids come from env so they never hardcode secrets
// and are easy to set per-environment in Vercel. All optional — unset → no-op.
const GA_ID = process.env.NEXT_PUBLIC_GA4_ID;
const GSC_VERIFICATION = process.env.NEXT_PUBLIC_GSC_VERIFICATION;
const BING_VERIFICATION = process.env.NEXT_PUBLIC_BING_VERIFICATION;

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
  alternates: {
    canonical: "/",
    // Single global English site; declare regional variants at x-default so
    // Google serves the same content to US and India English queries.
    languages: { "en-US": "/", "en-IN": "/", "x-default": "/" },
  },
  verification: {
    ...(GSC_VERIFICATION ? { google: GSC_VERIFICATION } : {}),
    ...(BING_VERIFICATION ? { other: { "msvalidate.01": BING_VERIFICATION } } : {}),
  },
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
      logo: `${SITE}/icon.png`,
      email: "hello@furlpay.com",
      sameAs: [
        "https://github.com/Ashutosh0x/furlpay",
        "https://x.com/furlpay",
        "https://instagram.com/furlpay",
        "https://linkedin.com/company/furlpay",
        "https://discord.gg/PUExXrMt3z",
        "https://t.me/FurlpayBot",
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
        {/* Google Analytics 4 — loads only when NEXT_PUBLIC_GA4_ID is set. */}
        {GA_ID && (
          <>
            {/* Consent Mode v2: default everything to denied BEFORE gtag.js
                loads, so no analytics/ad cookies are set until the visitor
                opts in via ConsentManager. Must run before the config below. */}
            <Script id="consent-default" strategy="beforeInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',wait_for_update:500});`}
            </Script>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga4-init" strategy="afterInteractive">
              {`gtag('js',new Date());gtag('config','${GA_ID}');`}
            </Script>
          </>
        )}
        {/* Shell picks full-bleed (marketing/docs) vs phone-frame app chrome. */}
        <Shell>{children}</Shell>
        {GA_ID && <ConsentManager />}
      </body>
    </html>
  );
}
