import Link from "next/link";
import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";

export const metadata: Metadata = {
  title: "Furlpay vs RedotPay — Feature Comparison",
  description:
    "How does Furlpay compare to RedotPay? Open-source, AI-native, on-device mobile keys, fractional investing, multi-currency banking, x402 agentic payments — see the full breakdown.",
  alternates: { canonical: "/compare/redotpay" },
  openGraph: {
    type: "website",
    url: "https://furlpay.com/compare/redotpay",
    siteName: "Furlpay",
    title: "Furlpay vs RedotPay — Feature Comparison",
    description: "How does Furlpay compare to RedotPay? Open-source, AI-native, on-device mobile keys, fractional investing, multi-currency banking, x402 agentic payments — see the full breakdown.",
    images: [{ url: "/og.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Furlpay vs RedotPay — Feature Comparison",
    description: "How does Furlpay compare to RedotPay? Open-source, AI-native, on-device mobile keys, fractional investing, multi-currency banking, x402 agentic payments — see the full breakdown.",
    images: ["/og.png"],
  },
};

const ROWS: { feature: string; furlpay: string; redotpay: string; furlpayWins: boolean }[] = [
  { feature: "Platform", furlpay: "Web, Desktop, Extension", redotpay: "Mobile-only", furlpayWins: true },
  { feature: "Source Code", furlpay: "Open (MIT)", redotpay: "Closed", furlpayWins: true },
  { feature: "AI Integration", furlpay: "Native (MCP, x402)", redotpay: "None", furlpayWins: true },
  { feature: "Custody Model", furlpay: "On-device key (mobile); custodial enclave (web)", redotpay: "Centralized", furlpayWins: false },
  { feature: "Fractional Stocks", furlpay: "Yes (Alpaca)", redotpay: "No", furlpayWins: true },
  { feature: "Multi-currency Banking", furlpay: "40+ currencies (Wise)", redotpay: "No", furlpayWins: true },
  { feature: "Developer SDK", furlpay: "Yes (TypeScript)", redotpay: "No", furlpayWins: true },
  { feature: "x402 Agentic Payments", furlpay: "Yes", redotpay: "No", furlpayWins: true },
  { feature: "MiCA Compliance", furlpay: "Yes (EURC auto-swap)", redotpay: "No", furlpayWins: true },
  { feature: "Stablecoin Card", furlpay: "Virtual Visa", redotpay: "Virtual + Physical", furlpayWins: false },
];

export default function CompareRedotPayPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-14">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">
          Compare
        </p>
        <h1 className="max-w-3xl text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[52px]">
          Furlpay vs RedotPay
        </h1>
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-textSecondary">
          Both let you spend crypto. But Furlpay is open-source, AI-native, and ships with
          fractional investing, multi-currency banking, a passkey wallet, and a full developer platform.
          Here&apos;s the side-by-side.
        </p>

        {/* Comparison table */}
        <div className="mt-14 overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-left text-[14px]">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03]">
                <th className="px-5 py-4 font-semibold text-textSecondary">Feature</th>
                <th className="px-5 py-4 font-bold text-neon">Furlpay</th>
                <th className="px-5 py-4 font-semibold text-textSecondary">RedotPay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {ROWS.map((row) => (
                <tr key={row.feature} className="transition-colors hover:bg-white/[0.02]">
                  <td className="px-5 py-4 font-medium">{row.feature}</td>
                  <td className={`px-5 py-4 ${row.furlpayWins ? "text-neon font-semibold" : ""}`}>
                    {row.furlpay}
                  </td>
                  <td className="px-5 py-4 text-textSecondary">{row.redotpay}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Analysis sections */}
        <div className="mt-16 space-y-8">
          <div className="glass-card p-6">
            <h2 className="text-[18px] font-bold">Open by default</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">
              Furlpay&apos;s SDK, CLI, MCP server, browser extension, and x402 facilitator are all
              MIT-licensed on GitHub. RedotPay is closed-source — you can&apos;t audit the code, fork
              it, or build extensions. In fintech, transparency isn&apos;t a nice-to-have; it&apos;s
              table stakes.
            </p>
          </div>

          <div className="glass-card p-6">
            <h2 className="text-[18px] font-bold">Built for AI agents</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">
              Furlpay ships with an MCP server and x402 facilitator so AI agents can discover,
              negotiate, and pay for HTTP resources programmatically. RedotPay has no developer
              APIs, no webhooks, and no machine-to-machine payment protocol.
            </p>
          </div>

          <div className="glass-card p-6">
            <h2 className="text-[18px] font-bold">More than a card</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">
              Beyond card spend, Furlpay offers fractional stock investing via Alpaca,
              multi-currency local accounts via Wise, portfolio-backed credit lines, yield on idle
              balances, and a Cmd+K command palette for power users. RedotPay focuses on card
              issuance and basic crypto-to-fiat conversion.
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-16 text-center">
          <h2 className="text-[24px] font-bold tracking-tighter">Ready to switch?</h2>
          <p className="mt-2 text-[14px] text-textSecondary">
            Get started in under 2 minutes — no app download required.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className="btn-green px-6 py-3 text-[15px]">
              Create your account
            </Link>
            <Link href="/docs" className="btn-outline px-6 py-3 text-[15px]">
              Read the docs
            </Link>
          </div>
        </div>

        <p className="mt-12 text-center text-[11px] text-textMuted">
          Comparison data is accurate as of July 2026 based on publicly available information.
          RedotPay is a trademark of its respective owner.
        </p>
      </main>
    </div>
  );
}
