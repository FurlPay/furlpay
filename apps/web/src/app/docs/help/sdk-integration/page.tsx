import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Code, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/sdk-integration");

export default function SdkHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">SDK and API support</DocTitle>
      <Lead>
        Use the SDK or API reference for its request contract, and check production availability
        separately for every payment rail.
      </Lead>

      <Callout type="warning" title="Credentials do not enable a service">
        An SDK can construct a request to a route that is not configured for production. Check
        <Code>/api/rails</Code> before exposing a money-moving flow, and treat an unavailable
        status as a stop condition.
      </Callout>

      <H2 id="packages">Developer packages</H2>
      <UL>
        <LI><Code>@furlpay/furlpay-node</Code> — Node.js / TypeScript server SDK.</LI>
        <LI><Code>@furlpay/gateway</Code> — self-hosted x402 gateway; choose a facilitator whose settlement is available.</LI>
        <LI><Code>@furlpay/mcp-server</Code> — MCP server for agent integrations; tool access depends on scopes.</LI>
      </UL>

      <H2 id="start-here">Start here</H2>
      <UL>
        <LI><Link href="/docs/quickstart" className="text-neon">Quickstart</Link> — rail status, fee estimates and payment-flow boundaries.</LI>
        <LI><Link href="/docs/architecture/api-routes" className="text-neon">API Routes</Link> — route groups, authentication and availability handling.</LI>
        <LI><Link href="/docs/architecture/webhooks" className="text-neon">Webhook Events</Link> — inbound provider webhooks and signature verification.</LI>
        <LI><Link href="/docs/architecture/errors" className="text-neon">Error Codes</Link> and <Link href="/docs/architecture/rate-limits" className="text-neon">Rate Limits</Link> — error and retry behavior.</LI>
      </UL>

      <H2 id="common-issues">Common integration issues</H2>
      <UL>
        <LI>
          <b>Webhook signature failures</b> — verify the provider-specific signature against the
          raw request body. Algorithms, timestamp checks and header names differ by provider.
        </LI>
        <LI>
          <b>429 responses</b> — respect <Code>Retry-After</Code> when present and apply bounded
          backoff rather than retrying in a tight loop.
        </LI>
        <LI>
          <b>Duplicate requests</b> — use <Code>Idempotency-Key</Code> only on routes that document
          idempotency, and persist the key for the whole retry window.
        </LI>
        <LI>
          <b>Intent created but no payment</b> — an intent is preparation data. Verify a confirmed
          settlement status and transaction reference before updating your order.
        </LI>
      </UL>

      <H2 id="getting-help">Getting help</H2>
      <P>
        Open a ticket in the <b>developers</b> category from the{" "}
        <Link href="/support" className="text-neon">Support Center</Link>. Include the route,
        response status, request ID and timestamp. Do not include secret keys, session cookies,
        private keys, one-time codes or recovery phrases.
      </P>

      <Callout type="info" title="Report vulnerabilities separately">
        For a security issue, use the{" "}
        <Link href="/legal/responsible-disclosure" className="text-neon">responsible disclosure process</Link>{" "}
        rather than a routine support ticket.
      </Callout>

      <DocPager pathname="/docs/help/sdk-integration" />
    </article>
  );
}
