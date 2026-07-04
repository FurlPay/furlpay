import Link from "next/link";
import type { Metadata } from "next";
import MarketingBar from "@/components/marketing/MarketingBar";
import PartnerMark from "@/components/brand/PartnerMark";

export const metadata: Metadata = {
  title: "Partners & Integrations",
  description:
    "Furlpay is built on world-class infrastructure — Solana, Base, Circle, Stripe, Wise, Alpaca, Turnkey, Safe, Persona, Marqeta, Bridge.xyz, and Vercel.",
  alternates: { canonical: "/partners" },
};

type Partner = {
  name: string;
  slug: string;
  role: string;
  description: string;
  category: "Infrastructure" | "Financial Services" | "Platform";
};

const PARTNERS: Partner[] = [
  {
    name: "Solana",
    slug: "solana",
    role: "Settlement layer",
    description:
      "Sub-second finality, <$0.01 fees. Furlpay uses Solana as the primary settlement rail for USDC payments and x402 agentic transactions.",
    category: "Infrastructure",
  },
  {
    name: "Base",
    slug: "base",
    role: "L2 settlement",
    description:
      "Coinbase's Ethereum L2 — EVM-compatible smart accounts, Safe wallets, and ERC-4337 account abstraction for gasless UX.",
    category: "Infrastructure",
  },
  {
    name: "Circle",
    slug: "circle",
    role: "USDC & EURC issuer",
    description:
      "The backbone stablecoins of Furlpay. Fully-reserved, audited, and natively supported across Solana and Base.",
    category: "Infrastructure",
  },
  {
    name: "Turnkey",
    slug: "turnkey",
    role: "MPC key custody",
    description:
      "Hardware-secured key shards with programmable policy gates. Powers Furlpay's 2-of-2 MPC custody model with passkey binding.",
    category: "Infrastructure",
  },
  {
    name: "Safe",
    slug: "safe",
    role: "Smart accounts",
    description:
      "ERC-4337 smart account infrastructure for Base — enabling batched transactions, social recovery, and spending policies.",
    category: "Infrastructure",
  },
  {
    name: "Stripe",
    slug: "stripe",
    role: "Fiat on/off-ramp",
    description:
      "Seamless fiat-to-crypto and crypto-to-fiat conversions. Powers the onboarding flow and bank withdrawal rails.",
    category: "Financial Services",
  },
  {
    name: "Wise",
    slug: "wise",
    role: "Multi-currency banking",
    description:
      "Local account details in 40+ currencies with real mid-market exchange rates. The banking layer behind Furlpay's global accounts.",
    category: "Financial Services",
  },
  {
    name: "Alpaca",
    slug: "alpaca",
    role: "Fractional investing",
    description:
      "Commission-free, fractional trading of 5,000+ US stocks and ETFs via API. Powers Furlpay's invest tab.",
    category: "Financial Services",
  },
  {
    name: "Marqeta",
    slug: "marqeta",
    role: "Card issuance",
    description:
      "Modern card issuing platform. Powers Furlpay's virtual Visa cards with real-time authorization, cashback, and spend controls.",
    category: "Financial Services",
  },
  {
    name: "Bridge.xyz",
    slug: "bridge",
    role: "Stablecoin orchestration",
    description:
      "APIs for stablecoin issuance, transfers, and conversions — enabling instant cross-chain and fiat settlement.",
    category: "Financial Services",
  },
  {
    name: "Persona",
    slug: "persona",
    role: "Identity verification",
    description:
      "Tiered KYC/KYB identity verification with document checks, selfie matching, and watchlist screening — compliant and fast.",
    category: "Platform",
  },
  {
    name: "Vercel",
    slug: "vercel",
    role: "Hosting & edge",
    description:
      "The Furlpay web app and marketing site run on Vercel's edge network — instant deploys, global CDN, and zero cold starts.",
    category: "Platform",
  },
];

const CATEGORIES = ["Infrastructure", "Financial Services", "Platform"] as const;

const CATEGORY_COLORS: Record<string, string> = {
  Infrastructure: "from-emerald-500/20 to-transparent",
  "Financial Services": "from-blue-500/20 to-transparent",
  Platform: "from-purple-500/20 to-transparent",
};

export default function PartnersPage() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar active="partners" />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-14">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">
          Partners &amp; Integrations
        </p>
        <h1 className="max-w-3xl text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[52px]">
          Best-in-class, composed.
        </h1>
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-textSecondary">
          Furlpay doesn&apos;t rebuild what already works. We compose the best infrastructure in
          crypto, banking, and identity into one seamless product.
        </p>

        <div className="mt-8 flex items-center gap-3 rounded-2xl border border-neon/20 bg-neon/[0.04] p-4">
          <PartnerMark slug="furlpay" name="Furlpay" className="h-11 w-11" />
          <div>
            <p className="text-[15px] font-bold">Furlpay</p>
            <p className="text-[13px] text-textMuted">
              One product, composed from the {PARTNERS.length} partners below.
            </p>
          </div>
        </div>

        {CATEGORIES.map((category) => (
          <section key={category} className="mt-16">
            <h2 className="mb-6 text-[20px] font-bold tracking-tighter">
              <span className="mr-2 inline-block h-2 w-2 rounded-full bg-neon shadow-[0_0_6px_theme(colors.neon)]" />
              {category}
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {PARTNERS.filter((p) => p.category === category).map((partner) => (
                <div
                  key={partner.name}
                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-6 transition-all hover:border-neon/25 hover:bg-white/[0.04]"
                >
                  {/* Subtle gradient accent */}
                  <div
                    className={`absolute inset-0 bg-gradient-to-br ${CATEGORY_COLORS[category]} opacity-0 transition-opacity group-hover:opacity-100`}
                  />
                  <div className="relative">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <PartnerMark slug={partner.slug} name={partner.name} className="h-11 w-11" />
                        <p className="text-[17px] font-bold">{partner.name}</p>
                      </div>
                      <span className="text-[11px] font-medium uppercase tracking-wider text-neon">
                        {partner.role}
                      </span>
                    </div>
                    <p className="mt-3 text-[14px] leading-relaxed text-textSecondary">
                      {partner.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        {/* CTA */}
        <div className="mt-20 glow-border p-6 text-center">
          <p className="text-[14px] font-bold text-neon">Become a partner</p>
          <p className="mt-1.5 text-[14px] text-textMuted">
            Building infrastructure that moves money? Let&apos;s talk.{" "}
            <a href="mailto:partners@furlpay.com" className="text-neon hover:underline">
              partners@furlpay.com
            </a>
          </p>
        </div>

        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link href="/signup" className="btn-green px-6 py-3 text-[15px]">
            Get started
          </Link>
          <Link href="/about" className="btn-outline px-6 py-3 text-[15px]">
            About Furlpay
          </Link>
        </div>
      </main>
    </div>
  );
}
