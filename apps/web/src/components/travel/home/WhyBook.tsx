import Link from "next/link";
import { BadgeDollarSign, Coins, Globe2, Sparkles, Wallet } from "lucide-react";
import { SectionHeader } from "./parts";

const PAY_LOGOS = [
  { src: "/logos/coins/usdc.svg", alt: "USDC" },
  { src: "/logos/coins/sol.svg", alt: "Solana" },
  { src: "/logos/coins/btc.svg", alt: "Bitcoin" },
  { src: "/logos/coins/eth.svg", alt: "Ethereum" },
  { src: "/logos/stocks/v.svg", alt: "Visa" },
  { src: "/logos/stocks/ma.svg", alt: "Mastercard" },
];

/** Five reasons, each one something this product does today or says plainly
 *  that it does not yet. */
export default function WhyBook({ destinationCount }: { destinationCount: number }) {
  const cards = [
    {
      href: "/travel/crypto-travel",
      Icon: Wallet,
      tint: "text-neon bg-neon/10 border-neon/25",
      title: "Pay your way",
      body: "USDC, SOL, BTC, 100+ tokens or Visa / Mastercard.",
      logos: true,
    },
    {
      href: "/travel/rewards",
      Icon: Coins,
      tint: "text-neon bg-neon/10 border-neon/25",
      title: "2% cashback",
      badge: "Coming soon",
      body: "USDC cashback on every booking — launching with travel rewards.",
    },
    {
      href: "/travel/help",
      Icon: BadgeDollarSign,
      tint: "text-neon bg-neon/10 border-neon/25",
      title: "Clear prices. Always.",
      body: "Prices calculated by FurlPay's server, every fee shown before you pay.",
    },
    {
      href: "#ai-planner",
      Icon: Sparkles,
      tint: "text-violet-300 bg-violet-500/15 border-violet-400/25",
      title: "AI-powered travel",
      body: "Plan, book and manage your trip with AI agents.",
    },
    {
      href: "/travel/destinations",
      Icon: Globe2,
      tint: "text-neon bg-neon/10 border-neon/25",
      title: "Global coverage",
      body: `${destinationCount} destination guides and live flight search via Duffel.`,
    },
  ];

  return (
    <section aria-labelledby="why-title">
      <SectionHeader id="why-title" title="Why book with FurlPay Travel" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {cards.map((c, i) => (
          <Link
            key={c.title}
            href={c.href}
            className={`group flex flex-col rounded-[14px] border border-white/[0.07] bg-gradient-to-b from-[#0D1213] to-[#090D0E] p-4 sm:p-5 ${i === 0 ? "col-span-2 lg:col-span-1" : ""} transition duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:shadow-[0_12px_30px_-14px_rgba(0,229,153,0.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon`}
          >
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl border ${c.tint}`}>
              <c.Icon className="h-5 w-5" aria-hidden />
            </span>
            <p className="mt-4 flex flex-wrap items-center gap-2 text-[15px] font-semibold text-white">
              {c.title}
              {"badge" in c && c.badge && (
                <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200">{c.badge}</span>
              )}
            </p>
            {c.logos && (
              <span className="mt-2.5 flex flex-wrap gap-1.5">
                {PAY_LOGOS.map((l) => (
                  <span key={l.alt} className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-white/15">
                    <img src={l.src} alt={l.alt} className="h-full w-full object-cover" />
                  </span>
                ))}
              </span>
            )}
            <p className="mt-2.5 text-[12px] leading-relaxed text-white/55">{c.body}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
