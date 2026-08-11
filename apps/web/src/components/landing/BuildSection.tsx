import Link from "next/link";
import { ArrowUpRight, Bot, Landmark, Plane, Store, Sparkles } from "lucide-react";
import Reveal from "./Reveal";

// Five things a developer can build, each linking to the solution page that
// already exists for it. Deliberately five large cards rather than fifteen
// small ones: the previous layout gave a compliance API and a browser
// extension identical visual weight, so nothing read as important.
const USE_CASES = [
  {
    Icon: Bot,
    title: "AI agents",
    body: "Give an autonomous agent its own wallet, a spending policy it cannot exceed, and the ability to pay per API call over x402 — with human approval required before money moves.",
    href: "/solutions/ai-agents",
    cta: "Agent infrastructure",
    wide: true,
  },
  {
    Icon: Landmark,
    title: "Global fintech",
    body: "Accounts, balances, cards and FX behind one API.",
    href: "/solutions/enterprise",
    cta: "Fintech stack",
  },
  {
    Icon: Plane,
    title: "Travel",
    body: "Stays and flights paid in stablecoins, settled on-chain.",
    href: "/products/travel",
    cta: "Travel payments",
  },
  {
    Icon: Store,
    title: "Marketplaces",
    body: "Take payment, split it, and pay sellers out in USDC.",
    href: "/solutions/ecommerce",
    cta: "Marketplace payouts",
  },
  {
    Icon: Sparkles,
    title: "Creator platforms",
    body: "Programmable payouts and rewards, without card rails.",
    href: "/payouts",
    cta: "Creator payouts",
  },
];

export default function BuildSection() {
  return (
    <section className="section section-y" id="build" aria-labelledby="build-title">
      <Reveal>
        <p className="section-eyebrow">What can you build</p>
        <h2 className="section-title mt-3 max-w-3xl" id="build-title">
          Build the financial layer of your product.
        </h2>
        <p className="section-lede mt-4">
          One integration covers payment acceptance, account balances, card issuing and
          settlement. What you assemble from those is up to you.
        </p>
      </Reveal>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {USE_CASES.map((useCase, i) => (
          <Reveal
            className={useCase.wide ? "sm:col-span-2 lg:col-span-2 lg:row-span-2" : ""}
            delay={i * 60}
            key={useCase.title}
          >
            <Link
              href={useCase.href}
              className={`surface surface-lift group flex h-full flex-col p-6 ${
                useCase.wide ? "sm:p-8" : ""
              }`}
            >
              <span
                aria-hidden
                className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-neon/20 bg-neonSoft text-neon transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-105"
              >
                <useCase.Icon className="h-5 w-5" />
              </span>
              <p className={`font-bold tracking-tight ${useCase.wide ? "text-[24px]" : "text-[18px]"}`}>
                {useCase.title}
              </p>
              <p
                className={`mt-2 flex-1 leading-relaxed text-textSecondary ${
                  useCase.wide ? "text-[15px]" : "text-[13.5px]"
                }`}
              >
                {useCase.body}
              </p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-textSecondary transition-colors group-hover:text-neon">
                {useCase.cta}
                <ArrowUpRight
                  aria-hidden
                  className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                />
              </span>
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
