import Link from "next/link";
import { ChevronLeft, Coins, ShieldCheck, Lock, Bot } from "lucide-react";

export const metadata = {
  title: "How to Pay for Travel with Crypto — FurlPay Travels",
  description: "Book hotels, flights, cars and activities with USDC, SOL, BTC and 100+ tokens. A 15-minute checkout quote and 2% cashback.",
};

const TOKENS = ["USDC", "USDT", "SOL", "BTC", "ETH", "cbBTC", "USDG", "PYUSD", "+ 100 more"];

const STEPS = [
  { t: "Search & select", b: "Find a stay, flight, car or activity." },
  { t: "Choose crypto at checkout", b: "Pick USDC, SOL, BTC — or connect Phantom / Coinbase Wallet." },
  { t: "A 15-minute quote", b: "Checkout shows a quote for 15 minutes; FurlPay's server re-prices it when you book." },
  { t: "Instant settlement", b: "Gasless USDC on Base via x402 settles in seconds (~$0.01 fee)." },
  { t: "Earn 2% cashback", b: "Cashback in USDC is credited to your FurlPay wallet once travel rewards launch (not live yet)." },
];

export default function CryptoTravelPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 pb-24 pt-6">
      <Link href="/travel" className="mb-3 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Travel
      </Link>

      <div className="flex items-center gap-2 text-neon">
        <Coins className="h-6 w-6" />
        <span className="text-xs font-semibold uppercase tracking-wider">Crypto Travel</span>
      </div>
      <h1 className="mt-3 text-3xl font-bold text-white">Pay for travel with stablecoins.</h1>
      <p className="mt-2 text-sm text-textSecondary">
        No cards, no borders, no chargebacks. Book the world with USDC, SOL, BTC and 100+ tokens — settled instantly
        on-chain, with a 15-minute checkout quote that the server re-checks when you book.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {TOKENS.map((t) => (
          <span key={t} className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-semibold text-white/80">
            {t}
          </span>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-bold text-white">How it works</h2>
      <ol className="mt-3 space-y-2.5">
        {STEPS.map((s, i) => (
          <li key={s.t} className="flex items-start gap-3 rounded-card border border-white/10 bg-charcoal p-4">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neon/15 text-xs font-bold text-neon">
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-semibold text-white">{s.t}</p>
              <p className="text-xs text-textSecondary">{s.b}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          { Icon: Lock, t: "Checkout quote", b: "Shown for 15 minutes, re-checked at booking." },
          { Icon: ShieldCheck, t: "Protected", b: "Travel Rule & KYC over $1,000." },
          { Icon: Bot, t: "Agent-ready", b: "AI agents can book via x402." },
        ].map((f) => (
          <div key={f.t} className="rounded-card border border-white/10 bg-charcoal p-4">
            <f.Icon className="h-4 w-4 text-neon" />
            <p className="mt-2 text-sm font-semibold text-white">{f.t}</p>
            <p className="text-[11px] text-textSecondary">{f.b}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 text-center">
        <Link href="/travel/stays" className="inline-block rounded-xl bg-neon px-6 py-3 text-sm font-bold text-black transition hover:bg-neonDeep">
          Book with crypto now
        </Link>
      </div>
    </div>
  );
}
