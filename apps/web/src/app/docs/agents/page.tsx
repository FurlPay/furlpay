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

export const metadata = { title: "Furlpay Docs — For AI Agents" };

export default function AgentsQuickstartPage() {
  return (
    <article>
      <DocTitle eyebrow="Getting Started">For AI Agents</DocTitle>
      <Lead>
        Give an AI agent a wallet in five minutes — and the guardrails to trust it with one. Furlpay is
        agent-native end to end: an MCP server for Claude and Cursor, LangChain / LlamaIndex tools,
        x402 pay-per-call rails, and TAP-style user mandates so an agent can only ever spend what its
        human signed off.
      </Lead>

      <H2 id="model">The mental model</H2>
      <DepGraph
        caption="Capability comes from tools; permission comes from the user's key. The agent holds neither your card nor your balance."
        layers={[
          { label: "Agent", nodes: [{ name: "Claude / Cursor / LangChain", sub: "calls tools, signs intents" }] },
          { label: "Trust", accent: true, nodes: [{ name: "mandate + budget", sub: "user-signed cap · MCC · expiry" }] },
          { label: "Rails", nodes: [{ name: "x402 / USDC", sub: "pay-per-call, no account" }, { name: "single-use VCN", sub: "MCC-locked Visa credential" }] },
        ]}
      />

      <H2 id="mcp">Path 1 — MCP (Claude, Cursor, any MCP client)</H2>
      <P>
        Two servers, one config block. <Code>@furlpay/mcp-server</Code> exposes the full API (balances,
        checkouts, transfers, investing); <Code>@furlpay/travel-mcp</Code> adds autonomous travel booking
        with live flight inventory:
      </P>
      <CodeBlock lang="json">{`{
  "mcpServers": {
    "furlpay": {
      "command": "npx", "args": ["-y", "@furlpay/mcp-server"],
      "env": { "FURLPAY_API_KEY": "fp_live_sk_..." }
    },
    "furlpay-travels": {
      "command": "npx", "args": ["-y", "@furlpay/travel-mcp"],
      "env": { "DUFFEL_API_KEY": "duffel_test_..." }   // omit everything for offline demo mode
    }
  }
}`}</CodeBlock>
      <P>
        Restart your client and ask: <i>&quot;find me a hotel in Mexico City under $200/night and hold it
        with a single-use card.&quot;</i> The agent searches, budget-checks, and authorizes — you approve
        the mandate.
      </P>

      <H2 id="langchain">Path 2 — LangChain / LlamaIndex</H2>
      <CodeBlock lang="python">{`# pip install furlpay-langchain   (or furlpay-llamaindex)
from furlpay_langchain import get_furlpay_tools

tools = get_furlpay_tools()   # 12 tools: pay, invest, transfer, swap + x402 pay_for_resource
agent = create_tool_calling_agent(llm, tools, prompt)
# set_agent_budget caps autonomous spend before the first tool call`}</CodeBlock>

      <H2 id="x402">Path 3 — x402: the agent pays for what it uses</H2>
      <P>
        No account, no API key, no card on file. The agent hits a metered endpoint, receives{" "}
        <Code>402 Payment Required</Code> with a signed quote, pays in USDC and retries. Full protocol on
        the <a href="/docs/payments/agentic-x402" className="text-neon hover:underline">x402 page</a>;
        selling your own API this way is one wrapper:
      </P>
      <CodeBlock lang="typescript">{`import { withX402 } from "@furlpay/x402";

export const GET = withX402(
  async () => Response.json({ signal: "premium market data" }),
  { payTo: "0xYourAddress", network: "base", amount: "10000" }
);`}</CodeBlock>

      <H2 id="mandate">The 5-minute mandate</H2>
      <P>
        Budgets cap <i>how much</i>; mandates prove <i>who allowed what</i>. The user signs once, the
        agent signs each intent, and the rail verifies the chain before issuing any credential:
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
        Open source (MIT) with the whole surface inspectable · one API spanning payments, banking, cards
        and investing · x402 member-standard rails (Linux Foundation) · TAP-aligned mandates shipping
        today, not on a roadmap. Start with <Code>furlpay-examples</Code> on GitHub — every stack,
        clone-and-run.
      </Callout>

      <DocPager pathname="/docs/agents" />
    </article>
  );
}
