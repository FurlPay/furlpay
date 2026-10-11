import Link from "next/link";
import { Calculator, FileText, ShieldCheck } from "lucide-react";
import TravelHeader from "@/components/travel/home/TravelHeader";

export const metadata = {
  title: { default: "FurlPay Travels — Book Travel with USDC & Crypto", template: "%s — FurlPay Travels" },
  description:
    "Plan stays, flights, cars and experiences and pay with USDC, SOL, BTC or other crypto. 2% USDC cashback once travel rewards launch.",
  alternates: { canonical: "/travel" },
  openGraph: {
    type: "website",
    url: "https://furlpay.com/travel",
    siteName: "Furlpay",
    title: "FurlPay Travels — Book Travel with USDC & Crypto",
    description:
      "Plan stays, flights, cars and experiences and pay with USDC, SOL, BTC or other crypto. 2% USDC cashback once travel rewards launch.",
    images: [{ url: "/og.png" }],
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "FurlPay Travels — Book Travel with USDC & Crypto",
    description: "Plan stays, flights, cars and experiences and pay with USDC or crypto.",
    images: ["/og.png"],
  },
};


const FOOTER_LINKS: Array<{ heading: string; links: Array<[string, string]> }> = [
  { heading: "Book", links: [["/travel/stays", "Stays"], ["/travel/hotels", "Hotels"], ["/travel/flights", "Flights"], ["/travel/car-rentals", "Cars"], ["/travel/activities", "Activities"], ["/travel/restaurants", "Restaurants"]] },
  { heading: "Explore", links: [["/travel/destinations", "Destinations"], ["/travel/itineraries", "Itineraries"], ["/travel/deals", "Deals"], ["/travel/visa", "Visa"], ["/travel/guides", "Guides"], ["/travel/blogs", "Stories"], ["/travel/vlogs", "Vlogs"]] },
  { heading: "Your travel", links: [["/travel/my-trips", "My Trips"], ["/travel/rewards", "Rewards"], ["/travel/alerts", "Price alerts"], ["/travel/refer", "Invite & earn"], ["/travel/business", "Business travel"]] },
  { heading: "Help", links: [["/travel/help", "Help & FAQ"], ["/travel/crypto-travel", "Crypto Travel 101"], ["/legal/refund", "Refund policy"], ["/legal/travel-rule", "Travel Rule"]] },
];

// FurlPay Travels portal shell: sticky glass header (logo, section links,
// search, currency, the signed-in user's wallet) and a minimal dark footer.
// Every section the previous horizontal nav listed is linked from the footer.
export default function TravelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#030505] text-white">
      <TravelHeader />

      <main>{children}</main>

      <footer className="border-t border-white/[0.06] bg-[#030505]">
        <div className="mx-auto grid max-w-[1400px] grid-cols-2 gap-8 px-4 py-10 sm:px-6 md:grid-cols-5 lg:px-10">
          <div className="col-span-2 md:col-span-1">
            <p className="text-[15px] font-bold text-white">
              Furlpay <span className="text-neon">Travels</span>
            </p>
            <p className="mt-2 max-w-[240px] text-[12px] leading-relaxed text-white/50">Plan anywhere. Book anything. Pay your way.</p>
          </div>
          {FOOTER_LINKS.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">{col.heading}</p>
              <ul className="mt-3 space-y-2">
                {col.links.map(([href, label]) => (
                  <li key={href}>
                    <Link href={href} className="text-[13px] text-white/65 transition hover:text-white">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        {/* Trust signals: only statements this code supports. Removed on
            2026-10-01 because nothing substantiated them: "PCI DSS card handling
            via Stripe" (travel checkout takes no card details and does not use
            Stripe), "15-minute rate lock" (the checkout timer is a client-side
            quote timer; no provider rate is held) and "Travel Rule & KYC
            compliant" (a compliance status the booking path does not enforce). */}
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 border-t border-white/[0.06] px-4 py-5 text-[12px] text-white/45 sm:px-6 lg:px-10">
          <span>© 2026 Furlpay. All rights reserved.</span>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-neon" aria-hidden /> Secured by FurlPay
            </span>
            <span className="flex items-center gap-1.5">
              <Calculator className="h-4 w-4 text-neon" aria-hidden /> Prices calculated by FurlPay&apos;s server
            </span>
            <Link href="/legal/travel-rule" className="flex items-center gap-1.5 hover:text-white">
              <FileText className="h-4 w-4 text-neon" aria-hidden /> Travel Rule policy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}