import type { Metadata } from "next";
import { Bot, Code2, CreditCard, Globe2, Plane, Repeat } from "lucide-react";
import LandingChrome from "@/components/landing/LandingChrome";
import EarlyAccessSignup from "@/components/marketing/EarlyAccessSignup";

export const metadata: Metadata = {
  title: "Early Access — The next chapter of finance is programmable",
  description:
    "Join the FurlPay early-access list. Stablecoin payment APIs, a passkey wallet and an x402 endpoint for AI agents are live today; cards, travel booking and agent settlement open to early members first.",
  alternates: { canonical: "/early-access" },
  openGraph: {
    title: "FurlPay Early Access",
    description: "The next chapter of finance is programmable. Be among the first in.",
    images: ["/media/early-access-card.jpg"],
  },
};

// Perks are a promise about the FUTURE, which is the one place forward-looking
// language is honest — an early-access list exists precisely because the
// products are not all open yet. What was wrong here was mixing tenses: "AI
// agent payments through x402 — live today" asserted a present capability in a
// list of future ones, and it is not live. Everything below is now framed as
// what membership gets you when each product opens.
const PERKS = [
  "Priority product access as we open the doors",
  "First availability for FurlPay Cards, where eligible",
  "Passkey wallet and developer platform access today",
  "First access to travel booking when the inventory provider goes live",
  "First access to x402 agent settlement when the facilitator is configured",
  "Developer APIs, SDKs and MCP tooling — available now, no waitlist",
  "Invitations to FurlPay Global events and roundtables",
];

const FEATURES = [
  {
    Icon: Globe2,
    title: "Pay globally with stablecoins",
    body: "Non-custodial USDC payment APIs across Solana, Arbitrum, Base and Ethereum — you sign, we quote, price and construct. Furlpay-operated settlement is in development.",
  },
  {
    Icon: Plane,
    title: "Travel the world",
    body: "Explore hotels worldwide on a live map today. Booking stays and flights, paid in stablecoins, is in development.",
  },
  {
    Icon: CreditCard,
    title: "Spend everywhere",
    body: "Card infrastructure to bring digital assets to everyday spending on traditional networks. In development — no card program has launched.",
  },
  {
    Icon: Repeat,
    title: "Swap across chains",
    body: "Cross-chain routing that builds the transaction for your own wallet to sign — one balance, many rails.",
  },
  {
    Icon: Code2,
    title: "Build with FurlPay",
    body: "APIs, SDKs, MCP servers, payment components and open-source tools for the next generation of fintech.",
  },
  {
    Icon: Bot,
    title: "Power AI agents",
    body: "Agents discover prices over real x402 challenges and our MCP server today. Paying per call and receiving machine-readable receipts is in development.",
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
    a: "Not yet. Hotel discovery is live — the map shows real properties worldwide — but booking is in development. The production inventory provider is on a test credential and Furlpay refuses to present sandbox offers as real availability, so no booking flow is open.",
  },
  {
    q: "Can developers use FurlPay today?",
    // Split, because the two halves have different answers. The SDKs, docs
    // and the 402 challenge endpoint genuinely respond in production — try
    // /api/x402/fx and a real payment challenge comes back. COMPLETING that
    // payment does not work: /api/rails reports the x402 facilitator as not
    // configured. "The APIs are live now" collapsed those into one claim and
    // the half that is false is the half a developer would act on.
    a: "The SDKs, developer docs and the x402 challenge endpoint are live at furlpay.com/developer — no waitlist. Settling an x402 payment is not yet enabled in production: the facilitator is pending configuration, so treat the pay-per-call flow as integrate-now, settle-soon.",
  },
];

export default function EarlyAccessPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
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
              The developer platform, passkey wallet and x402 challenge endpoint are live now.
              Cards, travel booking and end-to-end agent settlement open to early members first.
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
              <span className="font-semibold text-white">Live today.</span> The passkey wallet, the
              developer platform, live hotel discovery and a real x402 challenge endpoint run in
              production at furlpay.com. Travel booking and x402 settlement are in development.
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
