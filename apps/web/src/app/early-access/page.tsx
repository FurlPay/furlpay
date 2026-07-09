import type { Metadata } from "next";
import { Bot, Code2, CreditCard, Globe2, Plane, Repeat } from "lucide-react";
import MarketingBar from "@/components/marketing/MarketingBar";
import EarlyAccessSignup from "@/components/marketing/EarlyAccessSignup";

export const metadata: Metadata = {
  title: "Early Access — The next chapter of finance is programmable",
  description:
    "Get early access to FurlPay — the on-chain financial operating system for stablecoin payments, global travel, cards, and AI agent commerce powered by x402.",
  alternates: { canonical: "/early-access" },
  openGraph: {
    title: "FurlPay Early Access",
    description: "The next chapter of finance is programmable. Be among the first in.",
    images: ["/media/early-access-card.jpg"],
  },
};

const PERKS = [
  "Priority product access as we open the doors",
  "First availability for FurlPay Cards, where eligible",
  "Stablecoin wallet and cross-chain payments from day one",
  "Global travel booking with stablecoins and crypto",
  "AI agent payments through x402 — live today",
  "Developer APIs, SDKs and MCP tooling",
  "Invitations to FurlPay Global events and roundtables",
];

const FEATURES = [
  {
    Icon: Globe2,
    title: "Pay globally with stablecoins",
    body: "Send, receive and settle in USDC, XSGD and more across Solana, Arbitrum, Base, Ethereum and other supported networks.",
  },
  {
    Icon: Plane,
    title: "Travel the world",
    body: "Search and book stays and flights across 230+ countries and territories — pay with stablecoins, crypto or card.",
  },
  {
    Icon: CreditCard,
    title: "Spend everywhere",
    body: "Modern card infrastructure that brings digital assets to everyday spending on traditional payment networks.",
  },
  {
    Icon: Repeat,
    title: "Swap across chains",
    body: "Move value between assets and networks with live cross-chain routing — one balance, many rails.",
  },
  {
    Icon: Code2,
    title: "Build with FurlPay",
    body: "APIs, SDKs, MCP servers, payment components and open-source tools for the next generation of fintech.",
  },
  {
    Icon: Bot,
    title: "Power AI agents",
    body: "Autonomous agents discover prices, pay per call in stablecoins via x402, and receive machine-readable receipts.",
  },
];

const FAQ = [
  {
    q: "Is early access free?",
    a: "Yes. Joining the list is free and there is no obligation — you simply get invited before the general public.",
  },
  {
    q: "When will I get access?",
    a: "We are inviting members in waves, ordered by waitlist position and product interest. You will be emailed the moment your access opens.",
  },
  {
    q: "Which stablecoins and networks are supported?",
    a: "USDC, USDT, EURC, PYUSD, DAI, and the MAS-regulated XSGD and XUSD, across Solana, Arbitrum, Base, Ethereum, Polygon and more.",
  },
  {
    q: "Is the FurlPay card available yet?",
    a: "The card shown is a concept preview. Card programs roll out to early-access members first, subject to eligibility and region.",
  },
  {
    q: "Can I book travel with crypto?",
    a: "Yes — the travel platform is live, with stays and flights payable in stablecoins and crypto alongside traditional methods.",
  },
  {
    q: "Can developers use FurlPay today?",
    a: "Yes. The x402 pay-per-call APIs, SDKs and developer docs are live now at furlpay.com/developers — no waitlist required.",
  },
];

export default function EarlyAccessPage() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <main className="mx-auto max-w-6xl px-6 pb-24">
        {/* Hero */}
        <section className="grid items-center gap-10 pt-16 md:grid-cols-2">
          <div>
            <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">
              Early access
            </p>
            <h1 className="text-[40px] font-extrabold leading-[1.05] tracking-tighter sm:text-[54px]">
              The next chapter of finance is programmable.
            </h1>
            <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-textSecondary">
              Get early access to FurlPay — the on-chain financial operating system for
              stablecoin payments, global travel, cards, and AI agent commerce powered by x402.
            </p>
            <div className="mt-8 max-w-lg">
              <EarlyAccessSignup />
            </div>
            <p className="mt-4 text-[12px] text-textMuted">
              Free to join · no spam · one email when your access opens
            </p>
          </div>
          <figure className="relative">
            <img
              src="/media/early-access-card.jpg"
              alt="FurlPay Global card in a premium presentation box"
              className="w-full rounded-[26px] border border-white/10 object-cover shadow-[0_30px_80px_-20px_rgba(0,229,153,0.15)]"
            />
            <figcaption className="absolute bottom-3 right-4 rounded-full bg-black/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/70 backdrop-blur">
              Concept preview
            </figcaption>
          </figure>
        </section>

        {/* Card video */}
        <section className="mt-20">
          <div className="relative overflow-hidden rounded-[26px] border border-white/10">
            <video
              autoPlay
              loop
              muted
              playsInline
              poster="/media/early-access-card.jpg"
              className="h-auto w-full"
              aria-label="FurlPay card concept video"
            >
              <source src="/media/furlpay-card-premium.mp4" type="video/mp4" />
            </video>
            <span className="absolute bottom-3 right-4 rounded-full bg-black/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/70 backdrop-blur">
              Concept preview
            </span>
          </div>
          <h2 className="mt-10 text-center text-[28px] font-extrabold tracking-tight sm:text-[34px]">
            Your invitation to programmable finance.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-[15px] leading-relaxed text-textSecondary">
            Early members get priority consideration for new products, beta features, card
            programs, travel experiences and developer tools as they become available.
          </p>
        </section>

        {/* Perks */}
        <section className="mt-16">
          <h2 className="text-[22px] font-bold tracking-tight">What early access gets you</h2>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {PERKS.map((p) => (
              <li
                key={p}
                className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-[14px] text-textSecondary"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-neon" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </section>

        {/* Features */}
        <section className="mt-16">
          <h2 className="text-[22px] font-bold tracking-tight">Everything you can do with FurlPay</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-neon/25 bg-neon/[0.08] text-neon">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <p className="mt-3 text-[15px] font-semibold text-white">{title}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-textSecondary">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Trust — real facts only */}
        <section className="mt-16 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <h2 className="text-[22px] font-bold tracking-tight">Built in the open</h2>
          <div className="mt-4 grid gap-6 text-[14px] leading-relaxed text-textSecondary sm:grid-cols-3">
            <p>
              <span className="font-semibold text-white">Live today.</span> The x402 pay-per-call
              APIs, travel booking, multi-chain wallet and developer platform run in production at
              furlpay.com.
            </p>
            <p>
              <span className="font-semibold text-white">Open source.</span> SDKs, the browser
              extension and developer tooling are public on GitHub — inspect everything we ship.
            </p>
            <p>
              <span className="font-semibold text-white">Multi-chain by design.</span> Solana,
              Arbitrum, Base, Ethereum, Polygon and more — without forcing you into one ecosystem.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section className="mt-16">
          <h2 className="text-[22px] font-bold tracking-tight">Questions, answered</h2>
          <div className="mt-5 divide-y divide-white/[0.06] rounded-2xl border border-white/10 bg-white/[0.02]">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="group px-5 py-4">
                <summary className="cursor-pointer list-none text-[14px] font-semibold text-white marker:content-none">
                  {q}
                </summary>
                <p className="mt-2 text-[13px] leading-relaxed text-textSecondary">{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="mt-20 text-center">
          <h2 className="text-[30px] font-extrabold tracking-tight sm:text-[38px]">
            Be early to the next chapter of finance.
          </h2>
          <div className="mx-auto mt-6 max-w-md">
            <EarlyAccessSignup compact />
          </div>
        </section>
      </main>
    </div>
  );
}
