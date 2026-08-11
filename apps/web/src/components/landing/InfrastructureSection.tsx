import Link from "next/link";
import { ArrowRight, Banknote, CreditCard, Cpu, Wallet } from "lucide-react";
import Reveal from "./Reveal";

/*
 * Four categories, not twelve feature cards.
 *
 * The page previously listed twelve equal-weight tiles (Instant Convert, Earn
 * Yield, Browser Extension, Desktop App…), which reads as a changelog rather
 * than an architecture. Grouping them into what the money is actually doing —
 * moving, being issued, being held, being automated — lets a reader place their
 * own use case in seconds.
 *
 * Every capability listed is backed by a route or module in this repo; the
 * per-category footer link goes to the page that documents it.
 */
const CATEGORIES = [
  {
    Icon: Banknote,
    eyebrow: "Move money",
    title: "Payments that settle in seconds",
    items: [
      { name: "Stablecoin payments", note: "USDC over x402 and direct transfer" },
      { name: "Transfers", note: "Gasless EIP-3009, fees quoted in USDC" },
      { name: "Payouts", note: "Pay many recipients from one balance" },
      { name: "FX", note: "Mid-market quotes, priced per call" },
    ],
    href: "/products/payments",
  },
  {
    Icon: CreditCard,
    eyebrow: "Issue financial products",
    title: "Cards with controls in the rail",
    items: [
      { name: "Virtual cards", note: "Issued programmatically" },
      { name: "Physical cards", note: "Same controls, same ledger" },
      { name: "Spending controls", note: "Per-purchase and daily caps" },
      { name: "Policy engine", note: "Rules evaluated before authorization" },
    ],
    href: "/products/merchant",
  },
  {
    Icon: Wallet,
    eyebrow: "Build accounts",
    title: "Balances your users actually own",
    items: [
      { name: "Global accounts", note: "One handle, many chains" },
      { name: "Wallets", note: "Non-custodial, 2-of-2 MPC" },
      { name: "Balances", note: "Multi-asset, multi-chain" },
      { name: "Lot ledger", note: "Cost basis and corporate actions" },
    ],
    href: "/products/wallet",
  },
  {
    Icon: Cpu,
    eyebrow: "Automate finance",
    title: "Money under program control",
    items: [
      { name: "AI agents", note: "Owned keys with enforced policies" },
      { name: "x402", note: "HTTP 402 pay-per-call settlement" },
      { name: "Programmable payments", note: "Conditions before funds move" },
      { name: "Webhooks", note: "Signed, replay-protected delivery" },
    ],
    href: "/products/x402",
  },
];

export default function InfrastructureSection() {
  return (
    <section className="section section-y" id="infrastructure" aria-labelledby="infrastructure-title">
      <Reveal>
        <p className="section-eyebrow">Financial infrastructure</p>
        <h2 className="section-title mt-3 max-w-3xl" id="infrastructure-title">
          Four primitives. Everything else is composition.
        </h2>
        <p className="section-lede mt-4">
          Move money, issue products, hold balances, automate the whole thing. Each one is a
          documented API surface, not a bundle you have to take whole.
        </p>
      </Reveal>

      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        {CATEGORIES.map((cat, i) => (
          <Reveal delay={i * 70} key={cat.eyebrow}>
            <div className="surface surface-lift group h-full p-7 sm:p-8">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-neon/20 bg-neonSoft text-neon"
                >
                  <cat.Icon className="h-5 w-5" />
                </span>
                <p className="section-eyebrow">{cat.eyebrow}</p>
              </div>

              <p className="mt-5 text-[22px] font-bold tracking-tight sm:text-[24px]">{cat.title}</p>

              <ul className="mt-6 space-y-3">
                {cat.items.map((item) => (
                  <li key={item.name} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span aria-hidden className="mr-1 h-1.5 w-1.5 shrink-0 rounded-full bg-neon/70" />
                    <span className="text-[14px] font-semibold text-white">{item.name}</span>
                    <span className="text-[13px] text-textSecondary">{item.note}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={cat.href}
                className="mt-7 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-neon transition-colors hover:text-white"
              >
                Explore {cat.eyebrow.toLowerCase()}
                <ArrowRight aria-hidden className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
