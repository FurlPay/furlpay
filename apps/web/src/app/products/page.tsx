import type { Metadata } from "next";
import Link from "next/link";
import MarketingBar from "@/components/marketing/MarketingBar";
import { Hero, CtaBand } from "@/components/marketing/blocks";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "Products — Payments, Travel, Investing & Agentic Payments",
  description:
    "Explore Furlpay's products: USDC payments on Arbitrum at 0.5%, crypto travel booking, fractional investing, a passkey wallet, x402 agentic payments, and merchant acceptance.",
  alternates: { canonical: "/products" },
  openGraph: {
    type: "website",
    url: "https://furlpay.com/products",
    siteName: "Furlpay",
    title: "Products — Payments, Travel, Investing & Agentic Payments",
    description: "Explore Furlpay's products: USDC payments on Arbitrum at 0.5%, crypto travel booking, fractional investing, a passkey wallet, x402 agentic payments, and merchant acceptance.",
    images: [{ url: "/og.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Products — Payments, Travel, Investing & Agentic Payments",
    description: "Explore Furlpay's products: USDC payments on Arbitrum at 0.5%, crypto travel booking, fractional investing, a passkey wallet, x402 agentic payments, and merchant acceptance.",
    images: ["/og.png"],
  },
};

const PRODUCTS = [
  {
    href: "/products/payments",
    name: "Payments",
    tag: "0.5% fees",
    body: "Accept and send USDC on Arbitrum with sub-second settlement and a live fee API.",
  },
  {
    href: "/products/merchant",
    name: "Merchant acceptance",
    tag: "For business",
    body: "Take stablecoin payments online with hosted checkout, receipts, and refunds.",
  },
  {
    href: "/products/travel",
    name: "Travel",
    tag: "2.2M+ hotels",
    body: "Book hotels and flights and pay in USDC, with on-chain receipts and rewards.",
  },
  {
    href: "/products/investing",
    name: "Investing",
    tag: "Stocks & ETFs",
    body: "Hold fractional US stocks, ETFs, and crypto alongside your spending balance.",
  },
  {
    href: "/products/wallet",
    name: "Wallet",
    tag: "No seed phrase",
    body: "A passkey-secured MPC wallet — phishing-resistant, with no seed phrase to lose.",
  },
  {
    href: "/products/x402",
    name: "x402 for AI agents",
    tag: "Agentic",
    body: "Let AI agents discover, negotiate, and pay for HTTP resources over the x402 protocol.",
  },
];

export default function ProductsPage() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Products", path: "/products" },
        ])}
      />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-14">
        <Hero
          eyebrow="Products"
          title="One account for payments, travel, and investing."
          subtitle="Furlpay fuses stablecoin payments, global accounts, travel booking, and fractional investing into a single client — settled on Arbitrum, secured by passkeys, and open to AI agents."
          secondary={{ href: "/pricing", label: "See pricing" }}
        />

        {/* Launch announcement — wallet names. Links to both the reservation
            funnel and the launch post, so the campaign has one entry point on
            the highest-traffic product page. */}
        <section className="mt-12 rounded-2xl border border-neon/25 bg-neon/[0.04] p-6 sm:p-7">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-neon px-2.5 py-0.5 text-[11px] font-bold text-black">
              New
            </span>
            <span className="text-[11px] uppercase tracking-[0.14em] text-neon">
              Wallet names are live
            </span>
          </div>
          <h2 className="mt-3 text-[22px] font-bold leading-snug sm:text-[26px]">
            Claim the handle your AI agents will pay with.
          </h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-textSecondary">
            Reserve <span className="text-textPrimary">yourname.furlpay.com</span> — one
            human-readable identity for you and every agent you run, settled in USDC over the
            open x402 standard. Free to reserve, read-only permissions, and no money can move as
            a result of claiming a name.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/wallet"
              className="rounded-full bg-neon px-5 py-2.5 text-[14px] font-semibold text-black transition-opacity hover:opacity-90"
            >
              Reserve your name
            </Link>
            <Link
              href="/blog/furlpay-wallet-names-are-live-claim-your-payment-handle"
              className="rounded-full border border-white/15 px-5 py-2.5 text-[14px] font-semibold text-textPrimary transition-colors hover:border-neon/40"
            >
              Read the launch post
            </Link>
          </div>
        </section>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PRODUCTS.map((p) => (
            <Link key={p.href} href={p.href} className="glass-card group p-6 transition-colors hover:border-neon/30">
              <div className="flex items-center justify-between">
                <h2 className="text-[18px] font-bold">{p.name}</h2>
                <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] text-textMuted">
                  {p.tag}
                </span>
              </div>
              <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">{p.body}</p>
              <span className="mt-4 inline-block text-[13px] text-neon opacity-0 transition-opacity group-hover:opacity-100">
                Learn more →
              </span>
            </Link>
          ))}
        </div>

        <CtaBand title="Start in under two minutes" subtitle="No app download required." />
      </main>
    </div>
  );
}
