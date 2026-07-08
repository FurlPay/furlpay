// Interactive stack explorer — native <details> so it works server-rendered
// with zero client JS. Every "why" is a real engineering decision from this
// codebase, with the receipts linked.

const STACK: Array<{ name: string; category: string; why: string; link?: { href: string; label: string } }> = [
  {
    name: "Arbitrum One",
    category: "Settlement",
    why: "A settle() runs 202,667 gas — cents on Arbitrum, dollars on L1. That two-orders-of-magnitude margin against our 0.5% fee is what makes sponsoring gas for every user and agent viable.",
    link: { href: "/blog/bypassing-the-3-percent-card-tax-x402-settlement-layer-travel", label: "the full math" },
  },
  {
    name: "Solidity + Hardhat",
    category: "Smart contracts",
    why: "X402Facilitator holds no funds and no keys — USDC verifies the payer's EIP-3009 signature itself. FurlPayRouter hard-codes a 1% fee ceiling on-chain so a compromised API cannot overcharge.",
    link: { href: "https://github.com/Ashutosh0x/furlpay", label: "read the contracts" },
  },
  {
    name: "WebAuthn / Passkeys",
    category: "Security",
    why: "Private keys live in the device's secure enclave and unlock with FaceID — phishing-resistant by construction. Account addresses derive deterministically from the passkey, so you can receive funds before the contract is even deployed.",
  },
  {
    name: "Next.js 14",
    category: "Product",
    why: "One app serves the consumer client, 130+ API routes and 300+ statically generated SEO pages. Server components keep the payment logic off the client.",
  },
  {
    name: "Duffel",
    category: "Travel inventory",
    why: "Flights, stays and cars behind one token — live results when keys are set, a deterministic demo generator otherwise, so search never breaks in any environment.",
  },
  {
    name: "MCP + agent SDKs",
    category: "AI agents",
    why: "Our CLI ships an MCP server with 18 financial tools, listed on the official MCP Registry. Agents pay per request over x402 under user-signed spend mandates.",
    link: { href: "/integrations", label: "framework quickstarts" },
  },
];

export default function StackExplorer() {
  return (
    <div className="glass-card divide-y divide-white/5 p-2">
      {STACK.map((t) => (
        <details key={t.name} className="group px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <span className="font-mono text-[14px] font-bold text-white group-open:text-neon">{t.name}</span>
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-textSecondary">
              {t.category}
            </span>
          </summary>
          <p className="mt-2 text-[13.5px] leading-relaxed text-textMuted">
            {t.why}{" "}
            {t.link && (
              <a href={t.link.href} className="text-neon hover:underline">
                {t.link.label} →
              </a>
            )}
          </p>
        </details>
      ))}
    </div>
  );
}
