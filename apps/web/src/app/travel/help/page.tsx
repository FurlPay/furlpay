import Link from "next/link";
import { ChevronLeft, LifeBuoy, Mail, MessageCircle } from "lucide-react";

export const metadata = {
  title: "Travel Help & FAQ — FurlPay Travels",
  description: "Answers on booking, crypto payments, rewards, business travel, and AI-agent booking.",
};

const FAQ: { section: string; items: { q: string; a: string }[] }[] = [
  {
    section: "Booking",
    items: [
      { q: "How do I book?", a: "Search stays, flights, cars or activities, pick your option, and pay at checkout. Confirmation and e-vouchers are issued instantly." },
      { q: "Can I cancel or modify?", a: "Open the booking in My Trips and choose Cancel. Refunds follow the supplier's policy and are returned to your wallet or FurlPay balance." },
    ],
  },
  {
    section: "Payments",
    items: [
      { q: "Which cryptos are supported?", a: "USDC, SOL, BTC, ETH and 100+ tokens. Travala-routed bookings settle in gasless USDC on Base via x402." },
      { q: "Is the price locked?", a: "Yes — the exchange rate is locked for 15 minutes at checkout so you're never exposed to volatility." },
      { q: "How does refund work?", a: "Crypto bookings refund in USDC to your wallet; virtual-card bookings refund to your FurlPay balance." },
    ],
  },
  {
    section: "Rewards",
    items: [
      { q: "How does cashback work?", a: "Earn 2–7% cashback in USDC based on your tier, auto-deposited after your trip completes." },
      { q: "How do gift cards work?", a: "Buy with crypto, deliver instantly by email, and redeem for travel credit. Gift cards never expire." },
    ],
  },
  {
    section: "AI Agent Booking",
    items: [
      { q: "Can my AI agent book travel?", a: "Yes. FurlPay's MCP server + Travala's Travel MCP let an agent search, book, and pay over x402 within a budget you approve once." },
      { q: "How do budgets work?", a: "Set a USDC spend cap; the agent authorizes bookings up to that limit without further approval." },
    ],
  },
];

export default function TravelHelpPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 pb-24 pt-6">
      <Link href="/travel" className="mb-3 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Travel
      </Link>

      <div className="flex items-center gap-2 text-neon">
        <LifeBuoy className="h-6 w-6" />
        <span className="text-xs font-semibold uppercase tracking-wider">Travel Help</span>
      </div>
      <h1 className="mt-3 text-2xl font-bold text-white">How can we help?</h1>

      <div className="mt-5 space-y-5">
        {FAQ.map((s) => (
          <div key={s.section}>
            <h2 className="mb-2 text-sm font-bold text-white">{s.section}</h2>
            <div className="space-y-2">
              {s.items.map((it) => (
                <details key={it.q} className="rounded-card border border-white/10 bg-charcoal p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-white">{it.q}</summary>
                  <p className="mt-2 text-xs text-textSecondary">{it.a}</p>
                </details>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <a
          href="mailto:travel@furlpay.com"
          className="flex items-center gap-1.5 rounded-xl bg-neon px-5 py-3 text-sm font-bold text-black transition hover:bg-neonDeep"
        >
          <Mail className="h-4 w-4" /> travel@furlpay.com
        </a>
        <Link
          href="/talk-to-us"
          className="flex items-center gap-1.5 rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.06]"
        >
          <MessageCircle className="h-4 w-4" /> Live chat
        </Link>
      </div>
    </div>
  );
}
