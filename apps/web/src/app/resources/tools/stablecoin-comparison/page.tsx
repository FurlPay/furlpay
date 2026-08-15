import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import { webApplication, breadcrumb, SITE } from "@/lib/seo/schema";

const URL = `${SITE}/resources/tools/stablecoin-comparison`;

export const metadata: Metadata = {
  title: "Stablecoin Comparison — USDC vs USDT vs EURC vs DAI (2026)",
  description:
    "Compare USDC, USDT, EURC, and DAI across issuer, peg, reserves, attestations, and chains. A practical reference for choosing a stablecoin to accept for payments.",
  alternates: { canonical: "/resources/tools/stablecoin-comparison" },
};

const COLS = ["USDC", "USDT", "EURC", "DAI"];
const ROWS: { label: string; cells: string[] }[] = [
  { label: "Issuer", cells: ["Circle (US-regulated)", "Tether (offshore)", "Circle", "Sky / MakerDAO (decentralised)"] },
  { label: "Peg", cells: ["US dollar", "US dollar", "Euro", "US dollar"] },
  { label: "Backing", cells: ["Cash + short-dated US Treasuries", "Mixed reserves", "Cash + euro reserves", "Crypto collateral + RWAs"] },
  { label: "Attestations", cells: ["Monthly, third-party", "Quarterly", "Monthly, third-party", "On-chain, transparent"] },
  { label: "Model", cells: ["Centralised, fiat-backed", "Centralised, fiat-backed", "Centralised, fiat-backed", "Decentralised, over-collateralised"] },
  { label: "Best for", cells: ["US/EU payments & compliance", "Global liquidity & exchanges", "Euro-denominated payments", "DeFi-native, censorship-resistant"] },
];

const FAQ = [
  {
    q: "Which stablecoin is best to accept for payments?",
    a: "For US and EU merchants, USDC is the common default: monthly third-party attestations, cash and short-dated Treasury reserves, and a regulation-forward issuer. USDT has the deepest global liquidity; EURC suits euro pricing; DAI is decentralised. Furlpay settles USDC on Arbitrum.",
  },
  {
    q: "What is the difference between USDC and USDT?",
    a: "Both are dollar-pegged, but USDC (Circle) publishes monthly third-party attestations and holds cash plus short-dated US Treasuries under a US-regulated issuer, while USDT (Tether) has the largest global liquidity but less granular reserve disclosure. For compliance-sensitive payments, USDC is usually preferred.",
  },
  {
    q: "Does the blockchain matter as much as the stablecoin?",
    a: "Yes — arguably more for cost. The same USDC costs over a dollar to move on Ethereum mainnet but a fraction of a cent on Arbitrum. The network you settle on drives your per-transaction cost, which is why Furlpay uses Arbitrum.",
  },
];

export default function StablecoinComparisonPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={[
          webApplication({ name: "Furlpay Stablecoin Comparison", description: "Compare USDC, USDT, EURC, and DAI for payments.", url: URL, category: "ReferenceApplication" }),
          breadcrumb([
            { name: "Home", path: "/" },
            { name: "Resources", path: "/resources" },
            { name: "Tools", path: "/resources/tools" },
            { name: "Stablecoin Comparison", path: "/resources/tools/stablecoin-comparison" },
          ]),
        ]}
      />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-14">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Free tool</p>
        <h1 className="max-w-3xl text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[52px]">
          Stablecoin comparison
        </h1>
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-textSecondary">
          USDC, USDT, EURC, and DAI compared on what matters when you accept payments — issuer,
          reserves, transparency, and use case. For merchants, reserve quality and attestations
          usually matter more than market cap.
        </p>

        <div className="mt-10 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03]">
                <th className="px-4 py-3 font-semibold text-textSecondary">&nbsp;</th>
                {COLS.map((c, i) => (
                  <th key={c} className={`px-4 py-3 font-bold ${i === 0 ? "text-neon" : "text-white"}`}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {ROWS.map((row) => (
                <tr key={row.label}>
                  <td className="px-4 py-3 font-semibold text-textSecondary">{row.label}</td>
                  {row.cells.map((cell, i) => (
                    <td key={i} className={`px-4 py-3 ${i === 0 ? "font-medium text-neon" : "text-textSecondary"}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <FaqSection items={FAQ} />

        <p className="mt-10 text-center text-[11px] text-textMuted">
          Informational only, not financial advice. Stablecoins carry issuer and peg risk and can lose
          value. Details accurate as of July 2026 and may change.
        </p>
      </main>
    </div>
  );
}
