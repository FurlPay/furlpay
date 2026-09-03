import type { Metadata, Viewport } from "next";
import JsonLd from "@/components/JsonLd";
import Script from "next/script";
import "./globals.css";
import Shell from "@/components/Shell";
import ConsentManager from "@/components/ConsentManager";
import SessionProvider from "@/components/auth/SessionProvider";
import { BalanceVisibilityProvider } from "@/components/user/BalanceVisibility";

// Search-console / analytics ids come from env so they never hardcode secrets
// and are easy to set per-environment in Vercel. All optional — unset → no-op.
const GA_ID = process.env.NEXT_PUBLIC_GA4_ID;
const GSC_VERIFICATION = process.env.NEXT_PUBLIC_GSC_VERIFICATION;
const BING_VERIFICATION = process.env.NEXT_PUBLIC_BING_VERIFICATION;

const SITE = "https://furlpay.com";
const TITLE = "Furlpay — The On-Chain Financial Operating System";
const DESCRIPTION =
  "Stablecoin payments, global local accounts, and fractional stock investing in one web and desktop client, with passkey security and no gas fees.";

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
  /**
   * The favicon, declared explicitly.
   *
   * WHY IT IS DECLARED RATHER THAN INFERRED. Next serves a file named
   * `app/icon.png` as the icon automatically — but `public/icon.png` also
   * claims the `/icon.png` URL, and when both exist Next refuses to serve
   * either and answers 500 ("A conflicting public file and page file was
   * found"). The two files were byte-identical, added in the same commit.
   *
   * `public/` is the one that had to stay: ten places reference `/icon.png` as
   * a plain, stable URL — the web manifest, the JSON-LD organisation logo, the
   * press-kit download link, and the Solana Action metadata — and a hashed
   * route would break all of them. So `app/icon.png` was removed and the icon
   * is named here instead, which produces the same <link rel="icon"> without
   * competing for the URL. `app/apple-icon.png` has no such twin and keeps
   * working by file convention.
   */
  icons: { icon: "/icon.png" },
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
    site: "@furlpayglobal",
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
        "https://x.com/furlpayglobal",
        "https://www.youtube.com/@furlpay",
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
  // No maximumScale. Capping it at 1 blocks pinch-to-zoom, which is the
  // primary way a low-vision reader enlarges a page on a phone — WCAG 1.4.4
  // treats preventing it as a failure. It was presumably there to stop iOS
  // auto-zooming on focused inputs; the fix for that is a >=16px font size on
  // the input, not disabling zoom for everyone.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning is scoped to this ELEMENT's attributes, not
          its subtree, and it is here for one reason: browser extensions inject
          attributes onto <body> before React hydrates. ColorZilla adds
          `cz-shortcut-listen="true"`, Grammarly adds `data-gr-*`, and each one
          trips a hydration mismatch that no application change can prevent —
          the server cannot know what the visitor has installed. Children still
          hydrate normally, so a real mismatch inside the app is still reported. */}
      <body suppressHydrationWarning>
        <JsonLd data={JSON_LD} />
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
        {/* Shell picks full-bleed (marketing/docs) vs phone-frame app chrome.
            SessionProvider wraps it so identity is available to any client
            component. It is LAZY — nothing is fetched until something calls
            useSession() — so marketing pages cost no extra request. */}
        {/* BalanceVisibilityProvider sits inside the session so the account
            menu's "Blur balances" switch and every masked figure across the app
            read the same state. It holds a boolean and a localStorage read —
            no fetch — so a marketing page pays nothing for it. */}
        <SessionProvider>
          <BalanceVisibilityProvider>
            <Shell>{children}</Shell>
          </BalanceVisibilityProvider>
        </SessionProvider>
        {GA_ID && <ConsentManager />}
      </body>
    </html>
  );
}
