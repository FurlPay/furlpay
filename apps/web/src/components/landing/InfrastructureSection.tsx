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
 *
 * A route existing is NOT the same as the capability being available, and this
 * section used to conflate them — "Physical cards: same controls, same ledger"
 * sat beside "Stablecoin payments" in identical type, with nothing to tell a
 * reader that one is served today and the other has no card program behind it.
 * Each item now carries its own `soon` flag, rendered as a visible label, so
 * the grid states its own readiness instead of implying uniform availability.
 */
const CATEGORIES = [
  {
    Icon: Banknote,
    eyebrow: "Move money",
    title: "Payments that settle in seconds",
    items: [
      { name: "Stablecoin payments", note: "USDC over x402 and direct transfer" },
      { name: "FX", note: "Mid-market quotes, priced per call" },
      { name: "Transfers", note: "Gasless EIP-3009 relay; fee payer not yet configured", soon: true },
      { name: "Payouts", note: "Pay many recipients from one balance", soon: true },
    ],
    href: "/products/payments",
  },
  {
    Icon: CreditCard,
    eyebrow: "Issue financial products",
    title: "Cards with controls in the rail",
    items: [
      { name: "Policy engine", note: "Rules evaluated before authorization" },
      { name: "Spending controls", note: "Per-purchase and daily caps" },
      { name: "Virtual cards", note: "Issued programmatically; no card program yet", soon: true },
      { name: "Physical cards", note: "Same controls, same ledger", soon: true },
    ],
    href: "/products/merchant",
  },
  {
    Icon: Wallet,
    eyebrow: "Build accounts",
    title: "Balances your users actually own",
    items: [
      { name: "Wallets", note: "On-device keys (mobile), enclave signing (web)" },
      { name: "Balances", note: "Multi-asset, multi-chain" },
      { name: "Lot ledger", note: "Cost basis and corporate actions" },
      { name: "Global accounts", note: "One handle, many chains", soon: true },
    ],
    href: "/products/wallet",
  },
  {
    Icon: Cpu,
    eyebrow: "Automate finance",
    title: "Money under program control",
    items: [
      { name: "AI agents", note: "Owned keys with enforced policies" },
      { name: "x402", note: "HTTP 402 challenge and verification" },
      { name: "Webhooks", note: "Signed, replay-protected delivery" },
      { name: "x402 settlement", note: "Facilitator not yet configured in production", soon: true },
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
                    <span
                      aria-hidden
                      className={`mr-1 h-1.5 w-1.5 shrink-0 rounded-full ${"soon" in item && item.soon ? "bg-amber-400/70" : "bg-neon/70"}`}
                    />
                    <span className="text-[14px] font-semibold text-white">{item.name}</span>
                    {"soon" in item && item.soon && (
                      <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                        In development
                      </span>
                    )}
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
