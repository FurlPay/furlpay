import {
  DocTitle,
  Lead,
  H2,
  P,
  UL,
  LI,
  Code,
  CodeBlock,
  Callout,
  DocPager,
} from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/quickstart");

export default function QuickstartPage() {
  return (
    <article>
      <DocTitle eyebrow="Getting Started">Developer quickstart</DocTitle>
      <Lead>
        Start with a read-only rail check and fee quote. Then build against the route contract for
        the specific payment flow you need.
      </Lead>

      <Callout type="warning" title="A quote is not a payment">
        FurlPay&apos;s payment APIs can prepare quotes, intents and wallet-signable data. Production
        settlement is a separate capability and is not generally enabled. Never tell a customer
        that a payment completed until you have a confirmed settlement status and transaction
        reference.
      </Callout>

      <H2 id="rail-status">1. Check current rail status</H2>
      <P>
        The public rail registry lists protocols, assets, networks, limits and operational status.
        Check it before you integrate and again before you submit a payment:
      </P>
      <CodeBlock lang="bash">{"curl --fail-with-body https://furlpay.com/api/rails"}</CodeBlock>
      <P>
        Continue only when the selected rail reports a usable status. If the endpoint returns an
        error or cannot provide fresh status, treat availability as unknown and stop the payment
        flow. A test or live API credential does not turn on an unconfigured rail.
      </P>

      <H2 id="fee-quote">2. Request a fee estimate</H2>
      <P>
        The fee-estimate endpoint is public and read-only. Its <Code>amount</Code> parameter is in
        USD, not minor units:
      </P>
      <CodeBlock lang="bash">{"curl \"https://furlpay.com/api/payments/fees/estimate?amount=150&sourceChain=arbitrum\""}</CodeBlock>
      <P>
        The response is an estimate, not a locked conversion quote or promise that a payment can
        settle. Recheck the fee and rail status immediately before presenting a payment to a user.
      </P>

      <H2 id="create">3. Build the payment flow</H2>
      <P>
        The authenticated <Code>POST /api/payments/create</Code> route validates the request and
        returns an intent with EIP-712 signing data. The connected user&apos;s wallet signs that
        data. It may return <Code>503 service_unavailable</Code> when required production
        configuration is missing.
      </P>
      <P>
        <Code>POST /api/payments/execute</Code> accepts the signature and attempts the next step.
        A successful HTTP response or a created intent by itself is not proof of an on-chain
        transfer. Poll the payment status and verify the returned transaction reference. Review
        authentication, schemas, status codes and idempotency in the{" "}
        <a href="/docs/architecture/api-routes" className="text-neon hover:underline">
          API Routes reference
        </a>
        .
      </P>

      <H2 id="choose-integration">Choose your integration</H2>
      <UL>
        <LI>
          <a href="/docs/payments/agentic-x402" className="text-neon hover:underline">x402 and MPP</a>{" "}
          — HTTP payment challenges for metered API access; production settlement status is separate.
        </LI>
        <LI>
          <a href="/docs/payments/cctp" className="text-neon hover:underline">Circle CCTP</a> — build
          non-custodial cross-chain USDC transactions.
        </LI>
        <LI>
          <a href="/docs/payments/lifi-swaps" className="text-neon hover:underline">LI.FI</a> — quote
          routes and prepare wallet-signed swaps.
        </LI>
        <LI>
          <a href="/docs/agents" className="text-neon hover:underline">Agent integrations</a> — MCP,
          scoped access and spend controls.
        </LI>
      </UL>

      <H2 id="keys">Credentials and safety</H2>
      <UL>
        <LI>Keep secret credentials on your server; never embed them in browser code or a mobile bundle.</LI>
        <LI>Use the credential type and authentication method documented for each route.</LI>
        <LI>Use an <Code>Idempotency-Key</Code> where the route supports it so retries do not create duplicate intents.</LI>
        <LI>Verify webhook signatures over the raw request body before processing an event.</LI>
        <LI>Never treat a sandbox response, demo inventory or generated signing data as proof of a production payment.</LI>
      </UL>

      <Callout title="Next">
        Read the <a href="/docs/architecture/api-routes" className="text-neon hover:underline">API Routes</a>{" "}
        and <a href="/docs/architecture/errors" className="text-neon hover:underline">Error Codes</a>{" "}
        references, then confirm availability at <Code>/api/rails</Code>.
      </Callout>

      <DocPager pathname="/docs/quickstart" />
    </article>
  );
}
