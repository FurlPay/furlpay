import Link from "next/link";
import { Trophy, Check } from "lucide-react";
import { REWARD_TIERS } from "@/lib/travel/data";

export const metadata = {
  title: "Travel Rewards — FurlPay Travels",
  description: "Earn 2–7% cashback in USDC on every booking. The more you travel, the more you earn.",
};

const STEPS = [
  "Book any stay, flight, car, or activity.",
  "Complete your trip.",
  "2–7% cashback in USDC to your FurlPay wallet (planned; travel rewards are not live yet).",
  "Use rewards for future bookings or withdraw to an external wallet.",
];

export default function RewardsPage() {
  return (
    <div className="mx-auto max-w-4xl px-5 pb-24 pt-8">
      <div className="flex items-center gap-2 text-amber-300">
        <Trophy className="h-6 w-6" />
        <span className="text-xs font-semibold uppercase tracking-wider">FurlPay Travel Rewards</span>
      </div>
      <h1 className="mt-3 text-3xl font-bold text-white">Earn crypto on every trip.</h1>
      <p className="mt-2 max-w-xl text-sm text-textSecondary">
        Cashback in USDC, credited to your wallet once travel rewards launch (not live yet). The more you book, the higher your tier — up to 7% back.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {REWARD_TIERS.map((t, i) => (
          <div
            key={t.tier}
            className={`rounded-card border p-5 ${i === 3 ? "border-amber-400/40 bg-gradient-to-b from-amber-500/10 to-charcoal" : "border-white/10 bg-charcoal"}`}
          >
            <p className="text-sm font-semibold text-white">{t.tier}</p>
            <p className="mt-2 text-3xl font-bold text-neon">{t.cashback}</p>
            <p className="text-[11px] text-textSecondary">cashback in USDC</p>
            <p className="mt-3 text-[11px] text-textSecondary">{t.req}</p>
            <p className="mt-2 text-xs text-white/80">{t.perks}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-card border border-white/10 bg-charcoal p-6">
        <p className="text-sm font-semibold text-white">How rewards work</p>
        <ol className="mt-3 space-y-2 text-sm text-textSecondary">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neon/15 text-[11px] font-bold text-neon">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-6 text-center">
        <Link href="/travel" className="inline-block rounded-xl bg-neon px-6 py-3 text-sm font-bold text-black transition hover:bg-neonDeep">
          Start earning — book a trip
        </Link>
      </div>
    </div>
  );
}
