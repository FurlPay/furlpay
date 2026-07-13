import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Code, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/gasless-transfers");

export default function GaslessHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Gasless Transfers</DocTitle>
      <Lead>
        Sending USDC normally requires holding the network&apos;s gas token (ETH on Arbitrum or
        Base) just to pay the fee. FurlPay removes that: you sign, FurlPay&apos;s sponsor submits
        and pays the gas.
      </Lead>

      <H2 id="how">How it works</H2>
      <P>
        USDC supports <Code>transferWithAuthorization</Code> (EIP-3009): instead of submitting a
        transaction yourself, you sign an <b>authorization</b> — a message saying &quot;move N USDC
        from me to them, once, before this deadline.&quot; FurlPay&apos;s fee payer submits that
        authorization on-chain and pays the gas. The signature is single-use (a nonce burns with
        it), amount-exact, and recipient-exact — the sponsor cannot alter or reuse it.
      </P>

      <H2 id="what-it-means">What this means for you</H2>
      <UL>
        <LI>You can hold <b>only USDC</b> and still send it — no topping up ETH first.</LI>
        <LI>The quoted amount is what leaves your balance; the network fee is the sponsor&apos;s problem.</LI>
        <LI>Your key signs a message, not a transaction — the same fingerprint confirmation as any other send.</LI>
      </UL>

      <H2 id="networks">Supported networks</H2>
      <P>
        Gasless sending works on the EVM networks where FurlPay runs a sponsor, Arbitrum first.
        The send screen shows a &quot;no network fee&quot; label when the rail applies; on
        networks without a sponsor, the standard flow applies instead.
      </P>

      <Callout type="info" title="Rate limits protect the sponsor">
        Sponsored submission is metered (a small per-minute budget per user) because every call
        costs FurlPay real gas. Normal use never hits it; a script hammering the endpoint will.
      </Callout>

      <P>
        Developers can read the protocol-level docs at{" "}
        <Link href="/docs/payments/agentic-x402" className="text-neon">Agentic Payments (x402)</Link>{" "}
        — the same EIP-3009 mechanism powers pay-per-call for AI agents.
      </P>

      <DocPager pathname="/docs/help/gasless-transfers" />
    </article>
  );
}
