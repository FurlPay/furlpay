import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Code, CodeBlock, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/sdk-integration");

export default function SdkHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">SDK &amp; API Support</DocTitle>
      <Lead>
        Where to start as an integrator, and where to go when something breaks. The deep technical
        references live in the developer sections of these docs — this page is the map.
      </Lead>

      <H2 id="packages">The packages</H2>
      <UL>
        <LI><Code>@furlpay/furlpay-node</Code> — the server SDK for the REST API.</LI>
        <LI><Code>@furlpay/gateway</Code> — self-hostable x402 paywall for your own endpoints.</LI>
        <LI><Code>@furlpay/mcp-server</Code> — expose FurlPay to Claude and other MCP clients.</LI>
        <LI><Code>@furlpay/cli</Code> — terminal workflows, webhook forwarding, and an MCP server.</LI>
      </UL>
      <CodeBlock lang="bash">{`npm install @furlpay/furlpay-node
# or paywall your own API:
npm install @furlpay/gateway`}</CodeBlock>

      <H2 id="start-here">Start here</H2>
      <UL>
        <LI><Link href="/docs/quickstart" className="text-neon">Quickstart</Link> — first API call, webhook forwarding, checkout widget.</LI>
        <LI><Link href="/docs/architecture/api-routes" className="text-neon">API Routes</Link> — the REST surface, auth, idempotency.</LI>
        <LI><Link href="/docs/architecture/webhooks" className="text-neon">Webhook Events</Link> — signature verification for every inbound event.</LI>
        <LI><Link href="/docs/architecture/errors" className="text-neon">Error Codes</Link> and <Link href="/docs/architecture/rate-limits" className="text-neon">Rate Limits</Link> — what a 4xx is telling you.</LI>
      </UL>

      <H2 id="common-issues">The three most common integration issues</H2>
      <UL>
        <LI>
          <b>Webhook signature failures</b> — verify the HMAC over the <b>raw</b> request body,
          before any JSON parsing or re-serialization touches it. Framework middleware that
          pre-parses JSON is the usual culprit.
        </LI>
        <LI>
          <b>429s in loops</b> — respect the <Code>Retry-After</Code> header instead of hammering.
          Budgets exist per route; the rate-limits page lists them.
        </LI>
        <LI>
          <b>Duplicate payments on retry</b> — send an <Code>Idempotency-Key</Code> header on
          money-moving POSTs. Retries with the same key replay the original response instead of
          paying twice.
        </LI>
      </UL>

      <H2 id="getting-help">Getting help</H2>
      <P>
        Open a ticket in the <b>developers</b> category from the{" "}
        <Link href="/support" className="text-neon">Support Center</Link> with the request id from
        the error response, your endpoint, and a timestamp. Never include API keys — pasted
        secrets are stripped automatically, so a ticket can&apos;t leak them, but a rotated key is
        still safer than a stripped one.
      </P>

      <Callout type="info" title="Security disclosure is a different door">
        A vulnerability report should not be a support ticket — use the{" "}
        <Link href="/legal/responsible-disclosure" className="text-neon">responsible disclosure</Link>{" "}
        process instead.
      </Callout>

      <DocPager pathname="/docs/help/sdk-integration" />
    </article>
  );
}
