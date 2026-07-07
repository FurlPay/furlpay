import Link from "next/link";
import { ShieldCheck, Lock, Timer, BadgeCheck } from "lucide-react";
import TravelNav from "@/components/travel/TravelNav";

export const metadata = {
  title: { default: "FurlPay Travels — Book Travel with USDC & Crypto", template: "%s — FurlPay Travels" },
  description:
    "Book 2.2M+ stays, flights, cars and experiences with USDC, SOL, BTC or 100+ cryptos. 2% cashback on every booking, settled via x402.",
  alternates: { canonical: "/travel" },
  openGraph: {
    type: "website",
    url: "https://furlpay.com/travel",
    siteName: "Furlpay",
    title: "FurlPay Travels — Book Travel with USDC & Crypto",
    description:
      "Book 2.2M+ stays, flights, cars and experiences with USDC, SOL, BTC or 100+ cryptos. 2% cashback on every booking.",
    images: [{ url: "/og.png" }],
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "FurlPay Travels — Book Travel with USDC & Crypto",
    description: "Book 2.2M+ stays, flights, cars and experiences with USDC and 100+ cryptos. 2% cashback.",
    images: ["/og.png"],
  },
};

// FurlPay Travels portal shell — full desktop layout (sticky glass header +
// horizontal section nav + trust footer). Replaces the 440px phone-frame app
// chrome, which made /travel look like a mobile app on desktop.
export default function TravelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-oled">
      <header className="sticky top-0 z-50 border-b border-white/5 bg-black/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
          <Link
            href="/"
            className="flex min-h-[44px] items-center gap-2 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon"
            aria-label="Furlpay home"
          >
            <Logo />
            <span className="text-lg font-extrabold tracking-tighter">Furlpay</span>
          </Link>
          <Link
            href="/travel"
            className="flex min-h-[44px] items-center rounded-lg text-sm font-semibold text-neon focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon"
          >
            Travels
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/travel/my-trips"
              className="hidden min-h-[44px] items-center rounded-pill border border-white/15 px-4 text-sm font-semibold text-white transition-colors hover:border-white/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon sm:flex"
            >
              My Trips
            </Link>
            <Link
              href="/dashboard"
              className="btn-green flex min-h-[44px] items-center px-5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              Open App
            </Link>
          </div>
        </div>
        {/* Section nav — horizontally scrollable on small screens */}
        <div className="mx-auto max-w-6xl px-5 pb-2.5">
          <TravelNav />
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t border-white/5">
        {/* Trust signals — calm, factual, near every exit point (2026 fintech UX) */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-5 py-6 text-[12px] text-textSecondary">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-neon" /> Secured by FurlPay
          </span>
          <span className="flex items-center gap-1.5">
            <Lock className="h-4 w-4 text-neon" /> PCI DSS card handling via Stripe
          </span>
          <span className="flex items-center gap-1.5">
            <Timer className="h-4 w-4 text-neon" /> 15-minute rate lock at checkout
          </span>
          <span className="flex items-center gap-1.5">
            <BadgeCheck className="h-4 w-4 text-neon" /> Travel Rule &amp; KYC compliant
          </span>
        </div>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 border-t border-white/5 px-5 py-6 text-[12px] text-textMuted">
          <span>© 2026 Furlpay. All rights reserved.</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/" className="flex min-h-[24px] items-center hover:text-white">Home</Link>
            <Link href="/travel/help" className="flex min-h-[24px] items-center hover:text-white">Help &amp; FAQ</Link>
            <Link href="/travel/crypto-travel" className="flex min-h-[24px] items-center hover:text-white">Crypto Travel 101</Link>
            <Link href="/blog/category/travel" className="flex min-h-[24px] items-center hover:text-white">Travel Blog</Link>
            <Link href="/legal/refund" className="flex min-h-[24px] items-center hover:text-white">Refund Policy</Link>
            <Link href="/legal/travel-rule" className="flex min-h-[24px] items-center hover:text-white">Travel Rule</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Logo() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-neon shadow-glow-sm">
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-black" fill="none" stroke="currentColor" strokeWidth="3">
        <path d="M5 5h14M5 12h10M5 19h6" strokeLinecap="round" />
      </svg>
    </span>
  );
}
