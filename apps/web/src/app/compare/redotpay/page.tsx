import Link from "next/link";
import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";

export const metadata: Metadata = {
  title: "Furlpay vs RedotPay — Feature Comparison",
  description:
    "How does Furlpay compare to RedotPay? Open source, AI-native, on-device mobile keys and a live x402 endpoint — with investing, banking and cards still in development. See the full breakdown.",
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

// A comparison table is the sharpest claim surface on the site: a bare "Yes"
// in our column against a "No" in theirs is read as a shipped feature, and
// unlike prose it gives a reader no room to notice a hedge. Rows for
// capabilities that are not in production now say "In development" in our own
// column rather than "Yes" — a competitor's genuine shipped feature should not
// lose a row to our roadmap.
const ROWS: { feature: string; furlpay: string; redotpay: string; furlpayWins: boolean }[] = [
  { feature: "Platform", furlpay: "Web + Extension (mobile and desktop in development)", redotpay: "Mobile-only", furlpayWins: false },
  { feature: "Source Code", furlpay: "Open (MIT)", redotpay: "Closed", furlpayWins: true },
  { feature: "AI Integration", furlpay: "Native (MCP, x402)", redotpay: "None", furlpayWins: true },
  { feature: "Custody Model", furlpay: "On-device key (mobile); custodial enclave (web)", redotpay: "Centralized", furlpayWins: false },
  { feature: "Fractional Stocks", furlpay: "In development", redotpay: "No", furlpayWins: false },
  { feature: "Multi-currency Banking", furlpay: "In development", redotpay: "No", furlpayWins: false },
  { feature: "Developer SDK", furlpay: "Yes (TypeScript)", redotpay: "No", furlpayWins: true },
  { feature: "x402 Agentic Payments", furlpay: "402 challenge live; settlement in development", redotpay: "No", furlpayWins: true },
  { feature: "MiCA Compliance", furlpay: "Yes (EURC auto-swap)", redotpay: "No", furlpayWins: true },
  { feature: "Stablecoin Card", furlpay: "In development", redotpay: "Virtual + Physical", furlpayWins: false },
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
          Both aim at spending crypto, from different starting points. RedotPay ships a card
          today; Furlpay ships an open-source developer platform, a passkey wallet and a real
          x402 endpoint today, with the card, banking and investing still in development.
          Here&apos;s the side-by-side, with our unfinished rows marked as such.
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
              Beyond card spend, Furlpay ships a Cmd+K command palette and an open developer
              platform today, and has fractional stock investing via Alpaca, multi-currency local
              accounts via Wise, portfolio-backed credit lines and yield on idle balances in
              development — none of those four is available yet. RedotPay focuses on card issuance
              and basic crypto-to-fiat conversion, which it does today.
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
