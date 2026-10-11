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
  DepGraph,
  DocPager,
} from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/agents");

export default function AgentsQuickstartPage() {
  return (
    <article>
      <DocTitle eyebrow="Getting Started">For AI Agents</DocTitle>
      <Lead>
        Connect an AI agent to FurlPay through MCP and scoped tools, then apply identity and spend
        controls to the actions it prepares. Agent connectivity is available; payment settlement
        still depends on the status of the selected production rail and the user&apos;s approval.
      </Lead>

      <Callout type="warning" title="Agent access does not enable settlement">
        The MCP transport, agent keys and spend policies are separate from payment execution.
        Production x402, MPP and gasless settlement are currently in development. On 11 October
        2026, x402 returned 503 because operational controls were unavailable. A challenge, mandate
        or payment intent does not mean funds have moved. Check <Code>/api/rails</Code>{" "}
        before exposing a money-moving tool; if it cannot return a status, treat the rail as unavailable.
      </Callout>

      <H2 id="model">The mental model</H2>
      <DepGraph
        caption="Tools expose only scoped capabilities; the user retains control of payment authorization. Completion depends on an enabled rail."
        layers={[
          { label: "Agent", nodes: [{ name: "MCP / framework tools", sub: "read data or prepare an action" }] },
          { label: "Trust", accent: true, nodes: [{ name: "owned key + policy", sub: "user-controlled limits and categories" }] },
          { label: "Payment", nodes: [{ name: "approval", sub: "user confirms the action" }, { name: "enabled rail", sub: "availability checked at runtime" }] },
        ]}
      />

      <H2 id="mcp">Path 1 — MCP (Claude, Cursor, any MCP client)</H2>
      <P>
        FurlPay exposes an MCP endpoint at <Code>/api/mcp</Code>. The tools presented to a client
        depend on the scopes the user grants. The connector can read authorized data and prepare
        financial actions for approval; it cannot bypass the payment rail or make an unavailable
        service live:
      </P>
      <CodeBlock lang="text">{"https://furlpay.com/api/mcp"}</CodeBlock>
      <P>
        For Claude setup and the exact read-only and prepare-only tools, see the{" "}
        <a href="/docs/integrations/claude-connector" className="text-neon hover:underline">
          Claude connector guide
        </a>
        . Travel MCP examples are integration previews; production travel booking is not currently
        available.
      </P>

      <H2 id="langchain">Path 2 — LangChain / LlamaIndex</H2>
      <P>
        Framework adapters may expose FurlPay tools to an agent, but the tool set and available
        operations depend on the integration and user&apos;s permissions. Treat read, prepare and
        execute as different capabilities; never assume a tool can complete a production payment.
      </P>

      <H2 id="x402">Path 3 — x402: metered HTTP requests</H2>
      <P>
        x402 lets an API return <Code>402 Payment Required</Code> with a payment challenge. The
        FurlPay x402 endpoint currently returns 503 because operational controls are unavailable,
        and production settlement is also in development. Agents cannot rely on completing paid
        requests through FurlPay. Read the{" "}
        <a href="/docs/payments/agentic-x402" className="text-neon hover:underline">x402 guide</a>{" "}
        for the protocol shape and check <Code>/api/rails</Code> before use:
      </P>
      <CodeBlock lang="typescript">{`import { withX402 } from "@furlpay/x402";

export const GET = withX402(
  async () => Response.json({ signal: "premium market data" }),
  { payTo: "0xYourAddress", network: "base", amount: "10000" }
);`}</CodeBlock>

      <H2 id="mandate">Illustrative user-signed spend mandate</H2>
      <P>
        Budgets cap <i>how much</i>; mandates prove <i>who allowed what</i>. The user signs once, the
        agent signs each intent, and an integrating service can verify the chain. This example is a
        library pattern only; it does not enable FurlPay production travel or payment settlement.
      </P>
      <CodeBlock lang="typescript">{`import { AgentTrust, generateKeypair, issueMandate, createBookingToken } from "@furlpay/agent-trust";

const user = generateKeypair("user"), agent = generateKeypair("agent");

// 1 · User consents: $500 trip, lodging+airlines, 7 days
const mandate = issueMandate({
  userPrivateKeyPem: user.privateKeyPem, userPublicKeyPem: user.publicKeyPem,
  agentKeyId: agent.keyId,
  constraints: { maxTotalUsd: 500, mccAllowlist: ["7011", "4511"],
                 expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() },
});

// 2 · Agent signs ONE exact intent per booking
const mandateToken = createBookingToken({
  mandate, agentPrivateKeyPem: agent.privateKeyPem, agentPublicKeyPem: agent.publicKeyPem,
  intent: { amountUsd: 320, source: "legacy", mcc: "7011" },
});

// 3 · The rail verifies the full chain — wrong amount, wrong MCC,
//     replayed token, exhausted budget: all fail closed.`}</CodeBlock>
      <P>
        Deep dive: <a href="/docs/payments/agent-trust" className="text-neon hover:underline">Agent Trust
        &amp; Mandates (TAP)</a> · applied to bookings:{" "}
        <a href="/docs/payments/travels-mcp" className="text-neon hover:underline">FurlPay Travels</a>.
      </P>

      <Callout title="Why builders pick Furlpay for agents">
        FurlPay provides an inspectable API, MCP connectivity and owned agent spend controls. Card
        issuing, banking, brokerage execution, travel booking and production agent settlement are
        not currently available live products. See the{" "}
        <a href="/docs" className="text-neon hover:underline">service availability overview</a>{" "}
        before choosing a flow.
      </Callout>

      <DocPager pathname="/docs/agents" />
    </article>
  );
}
