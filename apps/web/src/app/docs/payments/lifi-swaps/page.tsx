import { DocTitle, Lead, H2, P, UL, LI, Code, CodeBlock, Callout, EndpointTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/payments/lifi-swaps");

export default function LifiSwapsPage() {
  return (
    <article>
      <DocTitle eyebrow="Payments">LI.FI Swaps</DocTitle>
      <Lead>
        Cross-chain token swaps routed through LI.FI&apos;s aggregation network — the same routing used by
        MetaMask and Phantom. Furlpay quotes and builds the route; <b>your wallet signs and executes</b>,
        so the swap is non-custodial end to end.
      </Lead>

      <H2 id="how">How a swap works</H2>
      <UL>
        <LI>You ask for a route: from-token, to-token, chains, amount.</LI>
        <LI>LI.FI aggregates DEXes and bridges and returns the best route with a firm quote.</LI>
        <LI>Furlpay returns the unsigned transaction(s); your wallet signs and submits.</LI>
        <LI>Execution status is trackable per step until funds land on the destination chain.</LI>
      </UL>
      <EndpointTable
        rows={[
          { method: "POST", path: "/api/swaps/execute", desc: "Quote a route and build the client-signed swap transaction" },
        ]}
      />
      <CodeBlock lang="bash">{`curl -X POST https://furlpay.com/api/swaps/execute \\
  -H "content-type: application/json" \\
  -b "session" \\
  -d '{
    "fromChain": "arbitrum",
    "toChain": "base",
    "fromToken": "USDC",
    "toToken": "ETH",
    "amountUsd": 50,
    "fromAddress": "0xYourWallet"
  }'`}</CodeBlock>

      <H2 id="fees">Fee model</H2>
      <P>
        Routes carry a <b>0.5% integrator fee</b> on top of the route&apos;s own costs (DEX fees, bridge
        fees, gas). The fee is embedded in the quote you approve — what you sign is what you pay, and
        LI.FI forwards the integrator portion automatically. This is Furlpay&apos;s only markup on swaps.
      </P>

      <H2 id="guarantees">Guarantees and limits</H2>
      <UL>
        <LI><b>Non-custodial</b> — Furlpay never holds the tokens; the route executes from your wallet.</LI>
        <LI><b>Chains</b> — Arbitrum, Base, Ethereum, and Solana routes (including cross-VM SOL/ETH).</LI>
        <LI><b>Per-transaction cap</b> — swaps above the server-side limit (default $500, <Code>FURLPAY_MAX_SWAP_USD</Code>) are refused with <Code>amount_over_limit</Code>.</LI>
        <LI>Every executed and failed swap feeds the ops event ledger; the rail can be paused instantly from the control plane.</LI>
      </UL>

      <Callout type="info" title="Quotes are perishable">
        Routes reprice with the market. Execute a quote promptly; if it expires, request a fresh one
        rather than force-submitting a stale transaction that will revert.
      </Callout>

      <DocPager pathname="/docs/payments/lifi-swaps" />
    </article>
  );
}
