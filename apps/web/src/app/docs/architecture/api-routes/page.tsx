import {
  DocTitle,
  Lead,
  H2,
  P,
  UL,
  LI,
  Code,
  Callout,
  EndpointTable,
  DocPager,
} from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/architecture/api-routes");

export default function ApiRoutesPage() {
  return (
    <article>
      <DocTitle eyebrow="Architecture">API routes</DocTitle>
      <Lead>
        FurlPay exposes REST routes for payment preparation, agent integrations, authentication and
        read-only data. The route contract describes what a handler accepts; the rail registry
        describes whether a money-moving path is currently available.
      </Lead>

      <Callout type="warning" title="Check rail status before execution">
        Read <Code>GET /api/rails</Code> before sending or relaying a payment. A route can return a
        quote, challenge or intent while settlement remains unavailable. If the status endpoint
        errors or reports an unknown status, do not infer that a rail is operational.
      </Callout>

      <H2 id="discovery">Discovery and fee estimates</H2>
      <EndpointTable
        rows={[
          { method: "GET", path: "/api/rails", desc: "Public registry of rails, networks, assets, limits and current operational status" },
          { method: "GET", path: "/api/payments/fees/estimate?amount=…&sourceChain=…", desc: "Public fee estimate; amount is in USD" },
          { method: "GET", path: "/openapi.json", desc: "Machine-readable API description" },
        ]}
      />
      <P>
        The rail registry is the source for current payment availability. It may return{" "}
        <Code>503 controls_unavailable</Code> when its operational status cannot be read. Treat
        that response as unknown, not as permission to proceed.
      </P>

      <H2 id="payments">USDC payment intents</H2>
      <EndpointTable
        rows={[
          { method: "POST", path: "/api/payments/create", desc: "Authenticated payment intent and EIP-712 signing data; can return 503 when production configuration is missing" },
          { method: "POST", path: "/api/payments/execute", desc: "Submit the user's signature to the configured payment flow" },
          { method: "GET", path: "/api/payments/[id]", desc: "Read the payment's current status" },
          { method: "POST", path: "/api/payments/refund", desc: "Request a refund where the payment and rail support it" },
        ]}
      />
      <P>
        The current merchant product supports fee quotes and non-custodial payment preparation.
        FurlPay-operated production settlement is listed separately and remains gated. The create
        route requires an authenticated user session and may require a step-up proof; an API key
        alone does not satisfy that requirement.
      </P>
      <UL>
        <LI>A created payment ID is not a transaction hash.</LI>
        <LI><Code>202 Accepted</Code> may mean the payment is waiting for review or confirmation.</LI>
        <LI>Only a confirmed terminal status with a transaction reference proves settlement.</LI>
        <LI>Use <Code>Idempotency-Key</Code> only on routes that document support for it.</LI>
      </UL>

      <H2 id="agent-payments">x402 and Machine Payments Protocol</H2>
      <EndpointTable
        rows={[
          { method: "GET", path: "/api/x402/fx", desc: "Example paid resource; currently returns 503 while x402 operational controls are unavailable" },
          { method: "POST", path: "/api/x402/facilitator/verify", desc: "Validate an x402 payment payload" },
          { method: "POST", path: "/api/x402/facilitator/settle", desc: "Attempt x402 settlement when the production facilitator is configured" },
          { method: "GET", path: "/api/x402/settlement/[tx]", desc: "Check a pending x402 settlement" },
          { method: "GET", path: "/api/mpp/fx", desc: "Example paid resource using the MPP challenge and receipt headers" },
        ]}
      />
      <P>
        The x402 endpoint returned <Code>503 controls_unavailable</Code> with reason{" "}
        <Code>plan_limit</Code> on 11 October 2026. If it becomes available, challenge creation still
        does not mean x402 or MPP can settle a payment. Check each protocol&apos;s status in{" "}
        <Code>/api/rails</Code> and wait for a verified settlement result before releasing a paid resource.
      </P>

      <H2 id="client-signed">Client-signed cross-chain routes</H2>
      <EndpointTable
        rows={[
          { method: "POST", path: "/api/intents/cctp", desc: "Build a Circle CCTP burn or mint transaction" },
          { method: "GET", path: "/api/intents/cctp/attestation", desc: "Retrieve or poll a Circle Iris attestation" },
          { method: "POST", path: "/api/swaps/execute", desc: "Quote a LI.FI route and build transactions for client signing" },
          { method: "GET", path: "/api/transfers/gasless", desc: "Request the gasless USDC fee quote" },
          { method: "POST", path: "/api/transfers/gasless", desc: "Submit an EIP-3009 transfer for relaying when enabled" },
        ]}
      />
      <P>
        CCTP and LI.FI transactions are non-custodial: the client reviews, signs and submits the
        transaction. A route quote can expire or become unavailable. Gasless transfers require a
        separate production fee-payer configuration. Confirm the relevant rail is available before
        showing an executable action.
      </P>

      <H2 id="agent-access">Agent access and authentication</H2>
      <EndpointTable
        rows={[
          { method: "POST", path: "/api/agents/keys", desc: "Register an agent public key; authenticated registrations can carry an owned spend policy" },
          { method: "GET", path: "/api/agents/keys", desc: "List the caller's agent keys when authenticated" },
          { method: "DELETE", path: "/api/agents/keys", desc: "Revoke an owned agent key" },
          { method: "POST", path: "/api/auth/webauthn", desc: "Register or authenticate a passkey" },
          { method: "POST", path: "/api/mcp", desc: "MCP transport; tools depend on the user's granted scopes" },
        ]}
      />
      <P>
        The MCP transport and scoped agent controls do not bypass rail status or user authorization.
        Money-moving tools can prepare an action for approval; the available settlement path still
        depends on the selected rail.
      </P>

      <H2 id="not-live">Routes that are not live products</H2>
      <P>
        Routes may exist for card issuing, local banking, off-ramp, travel booking and stock orders
        while the corresponding production product is unavailable. Do not integrate those paths
        based on a route name or generated example. See the{" "}
        <a href="/docs" className="text-neon hover:underline">service availability overview</a>.
      </P>

      <H2 id="security">Request and response handling</H2>
      <UL>
        <LI>Use the authentication method documented for the specific route; there is no universal API-key shortcut.</LI>
        <LI>Validate all amounts, recipients, networks and transaction data on your side as well.</LI>
        <LI>Handle <Code>400</Code> validation errors, <Code>401</Code>/<Code>403</Code> authorization failures, <Code>409</Code> conflicts, <Code>429</Code> rate limits, and <Code>503</Code> unavailable rails distinctly.</LI>
        <LI>Verify signed webhook events using the integration-specific signing scheme before processing them; see <a href="/docs/architecture/webhooks" className="text-neon hover:underline">Webhook Events</a>.</LI>
      </UL>

      <DocPager pathname="/docs/architecture/api-routes" />
    </article>
  );
}
