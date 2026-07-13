import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Code, CodeBlock, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/x402-basics");

export default function X402BasicsHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">x402 Monetization Basics</DocTitle>
      <Lead>
        x402 lets you charge per request for anything served over HTTP — an API, a dataset, a
        model endpoint — and lets AI agents pay for it without an account, an API key, or a
        subscription.
      </Lead>

      <H2 id="idea">The idea in one paragraph</H2>
      <P>
        HTTP has always had a status code <Code>402 Payment Required</Code>; x402 finally gives it
        a protocol. Your endpoint answers an unpaid request with a 402 carrying a price quote. The
        caller — typically an AI agent — signs a USDC payment authorization and retries with it
        attached. A facilitator settles the payment on-chain, and your endpoint releases the
        response. No signup, no invoicing, no key management: paying <em>is</em> the
        authentication.
      </P>

      <H2 id="versions">Two protocol dialects, handled for you</H2>
      <P>
        x402 v1 carries payment data in <Code>X-PAYMENT</Code> headers and the 402 body; v2 (since
        December 2025) moved to <Code>PAYMENT-SIGNATURE</Code> / <Code>PAYMENT-REQUIRED</Code>{" "}
        headers with different shapes. FurlPay&apos;s tooling speaks both at once and answers in
        whichever dialect the caller used — you never configure a version.
      </P>

      <H2 id="start">Monetize an endpoint in three commands</H2>
      <CodeBlock lang="bash">{`npm install @furlpay/gateway
npx @furlpay/gateway secret        # generates your quote secret
npx @furlpay/gateway expose http://localhost:8000 \\
  --price 0.01 --pay-to 0xYourWallet --network base`}</CodeBlock>
      <P>
        That reverse proxy paywalls an API you cannot even modify. For code-level integration
        (Next.js routes, Express middleware), see the package docs on{" "}
        <a href="https://www.npmjs.com/package/@furlpay/gateway" className="text-neon">npm</a>.
      </P>

      <H2 id="protections">What the gateway protects you from</H2>
      <UL>
        <LI>Replay: one payment unlocks one response, exactly once — even under concurrent retries.</LI>
        <LI>Substitution: a payment quoted for a cheap endpoint cannot unlock an expensive one, or a different request body at the same price.</LI>
        <LI>Underpayment, expired quotes, wrong-network payments, and facilitator outages all fail closed.</LI>
      </UL>

      <Callout type="info" title="Where the money goes">
        Payments settle as USDC to the wallet you set in <Code>payTo</Code> — directly, on-chain.
        FurlPay never custodies your revenue.
      </Callout>

      <P>
        Full protocol documentation:{" "}
        <Link href="/docs/payments/agentic-x402" className="text-neon">Agentic Payments (x402)</Link>.
      </P>

      <DocPager pathname="/docs/help/x402-basics" />
    </article>
  );
}
