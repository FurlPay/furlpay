import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Callout } from "@/components/docs/prose";

export const metadata = {
  title: "Risk Disclosure — Furlpay Legal",
  description: "Key risks of using crypto-asset, stablecoin, card, credit and investment services on Furlpay.",
};

export default function RiskDisclosurePage() {
  return (
    <article>
      <DocTitle eyebrow="Legal">Risk Disclosure</DocTitle>
      <p className="mb-6 text-[13px] text-textMuted">Last updated: July 2, 2026</p>
      <Lead>
        Crypto-assets and the services built on them carry significant risk. You may lose some or all of
        your funds. Read this before using Furlpay. This is a plain-language summary, not an exhaustive
        list, and is not investment advice.
      </Lead>

      <H2 id="volatility">1. Market & volatility risk</H2>
      <P>
        The value of crypto-assets can move sharply and without warning. Stocks and ETFs accessed through
        Furlpay can lose value. Past performance is not indicative of future results.
      </P>

      <H2 id="stablecoin">2. Stablecoin de-peg risk</H2>
      <P>
        Stablecoins such as USDC and EURC aim to hold a stable value but can lose their peg due to issuer,
        reserve, market or regulatory events. A de-peg can affect balances, card settlement and yield.
      </P>

      <H2 id="no-insurance">3. Not bank deposits — no deposit insurance</H2>
      <P>
        Furlpay is not a bank. Crypto-asset balances are not covered by FDIC, FSCS or any government deposit
        insurance scheme. Fiat balances are held with licensed partners subject to their own terms.
      </P>

      <H2 id="smart-contract">4. Smart-contract & network risk</H2>
      <UL>
        <LI>On-chain transactions are irreversible; funds sent to a wrong address are typically unrecoverable.</LI>
        <LI>Smart contracts (Safe accounts, yield vaults, escrow) may contain bugs or be exploited.</LI>
        <LI>Blockchains (Solana, Base) can experience congestion, outages or re-orgs.</LI>
      </UL>

      <H2 id="credit">5. Credit & liquidation risk</H2>
      <P>
        The portfolio-backed credit line is collateralized by your assets. If your collateral value falls
        relative to your borrowed amount, some or all of your collateral may be liquidated to repay the
        loan, potentially at an unfavorable time and price.
      </P>

      <H2 id="custody">6. Self-custody & access risk</H2>
      <P>
        You hold one share of your 2-of-2 MPC key. Loss of your device and all recovery methods can result
        in permanent loss of on-chain funds.
      </P>

      <H2 id="agent">7. Agentic payment risk</H2>
      <P>
        When you authorize an AI agent to transact via x402 or MCP, it can move funds within the limits you
        set. Misconfigured budgets or allowlists can lead to unintended spend. See the{" "}
        <Link href="/legal/agent-terms" className="text-neon hover:underline">Agent Terms of Use</Link>.
      </P>

      <Callout title="Only risk what you can afford to lose">
        Do not use funds you cannot afford to lose. If you do not understand a product or risk, do not use
        it. Consider seeking independent financial and tax advice.
      </Callout>

      <div className="mt-12 border-t border-white/5 pt-6 text-[13px] text-textMuted">
        See also our{" "}
        <Link href="/legal/disclosures" className="text-neon hover:underline">Regulatory Disclosures</Link>{" "}
        and <Link href="/legal/terms" className="text-neon hover:underline">Terms of Service</Link>.
      </div>
    </article>
  );
}
