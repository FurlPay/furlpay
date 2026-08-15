import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";

export const metadata: Metadata = {
  title: "Grants & Ecosystem",
  description: "The grants and ecosystem programs Furlpay is eligible for and pursuing — Solana, Base, and the x402 ecosystem.",
  alternates: { canonical: "/grants" },
};

const GRANTS = [
  { name: "Superteam India", scope: "Solana microgrant — consumer payments & dev tooling", status: "Eligible" },
  { name: "Solana Foundation", scope: "PayFi / gasless stablecoin payments RFS — the first Solana x402 facilitator is a public good", status: "Eligible" },
  { name: "Base Builder Grants", scope: "Retroactive — x402 facilitator supports Base mainnet", status: "Eligible" },
  { name: "Coinbase CDP Builder Grant", scope: "AgentKit / x402 Bazaar — MCP + facilitator alignment", status: "Watching" },
  { name: "Fireblocks Grant Program", scope: "PYUSD / Solana / Stellar ecosystem", status: "Watching" },
];

export default function GrantsPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-14">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Ecosystem</p>
        <h1 className="text-[36px] font-extrabold tracking-tighter sm:text-[46px]">Grants &amp; programs</h1>
        <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-textSecondary">
          We build public goods — the first Solana-native x402 facilitator, open SDKs, and an MCP server.
          These are the ecosystem programs we&apos;re eligible for and pursuing. Building something on top of
          Furlpay?{" "}
          <a href="/talk-to-us" className="text-neon hover:underline">Talk to us</a>.
        </p>

        <div className="mt-10 divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10">
          {GRANTS.map((g) => (
            <div key={g.name} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{g.name}</p>
                <p className="text-[13px] text-textSecondary">{g.scope}</p>
              </div>
              <span
                className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  g.status === "Eligible" ? "bg-neon/15 text-neon" : "bg-white/[0.06] text-textSecondary"
                }`}
              >
                {g.status}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-6 text-[12px] text-textMuted">
          Furlpay&apos;s open-source repos are at{" "}
          <a href="https://github.com/FurlPay" className="text-neon hover:underline">github.com/FurlPay</a>.
        </p>
      </main>
    </div>
  );
}
