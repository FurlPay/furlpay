import type { Metadata } from "next";
import Link from "next/link";
import LandingChrome from "@/components/landing/LandingChrome";
import { Hero, CtaBand } from "@/components/marketing/blocks";
import JsonLd from "@/components/JsonLd";
import StatusPill from "@/components/marketing/StatusPill";
import { breadcrumb } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "Products — Stablecoin Payments, Wallet & x402 for Agents",
  description:
    "Explore Furlpay's products: USDC payment APIs on Arbitrum, a passkey wallet, x402 for AI agents, and merchant tooling. Travel booking, investing and card issuing are in development.",
  alternates: { canonical: "/products" },
  openGraph: {
    type: "website",
    url: "https://furlpay.com/products",
    siteName: "Furlpay",
    title: "Products — Stablecoin Payments, Wallet & x402 for Agents",
    description: "Explore Furlpay's products: USDC payment APIs on Arbitrum, a passkey wallet, x402 for AI agents, and merchant tooling. Travel booking, investing and card issuing are in development.",
    images: [{ url: "/og.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Products — Stablecoin Payments, Wallet & x402 for Agents",
    description: "Explore Furlpay's products: USDC payment APIs on Arbitrum, a passkey wallet, x402 for AI agents, and merchant tooling. Travel booking, investing and card issuing are in development.",
    images: ["/og.png"],
  },
};

// Each product carries the capability id that decides its badge, so this grid
// cannot drift from lib/productionStatus.ts. Before the badges existed all six
// cards looked identical, and a reader had no way to tell the wallet (usable
// today) from investing (no live brokerage) — the cards were the same size, the
// same colour, and written in the same present tense.
const PRODUCTS = [
  {
    href: "/products/payments",
    name: "Payments",
    capability: "payment-apis",
    body: "Quote fees and build non-custodial USDC transfers on Arbitrum that your own wallet signs.",
  },
  {
    href: "/products/merchant",
    name: "Merchant acceptance",
    capability: "payment-apis",
    body: "Hosted checkout, receipts and refunds over stablecoin rails, with a documented API.",
  },
  {
    href: "/products/travel",
    name: "Travel",
    capability: "travel-search",
    body: "Search hotels on a live global map today. Booking and paying in USDC is in development.",
  },
  {
    href: "/products/investing",
    name: "Investing",
    capability: "trading",
    body: "Live market data and charts today. Placing stock and ETF orders is in development.",
  },
  {
    href: "/products/wallet",
    name: "Wallet",
    capability: "passkeys",
    body: "A passkey-secured wallet — phishing-resistant, with no seed phrase to lose.",
  },
  {
    href: "/products/x402",
    name: "x402 for AI agents",
    capability: "x402-challenge",
    body: "Serve and answer HTTP 402 payment challenges. Settling a challenge is in development.",
  },
];

export default function ProductsPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Products", path: "/products" },
        ])}
      />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-14">
        <Hero
          eyebrow="Products"
          title="One platform for stablecoin payments."
          subtitle="Stablecoin payment APIs on Arbitrum, a passkey-secured wallet, and an x402 endpoint AI agents can talk to — in one open platform. Each card below says whether it is live today or still in development."
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
                <StatusPill id={p.capability} />
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
