import { DocTitle, Lead, H2, P, UL, LI, Code, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/integrations/ai-assistants");

export default function AiAssistantsPage() {
  return (
    <article>
      <DocTitle eyebrow="Integrations">AI assistants and MCP</DocTitle>
      <Lead>
        FurlPay provides an MCP endpoint for connecting compatible assistants and agent clients to
        scoped account tools. Tool availability depends on the user&apos;s consent and the status
        of any service the tool uses.
      </Lead>

      <Callout type="warning" title="An assistant cannot bypass payment controls">
        FurlPay&apos;s Claude connector can read authorized data and prepare certain actions for
        human approval. It cannot settle a payment from a chat message. x402, MPP and gasless
        production settlement remain gated. The x402 endpoint returned 503 controls_unavailable
        on 11 October 2026, so its challenge flow is currently unavailable as well.
      </Callout>

      <H2 id="mcp">Connect through MCP</H2>
      <P>
        The FurlPay MCP endpoint is <Code>https://furlpay.com/api/mcp</Code>. Claude and other
        compatible clients can use the endpoint&apos;s authorization flow and request only the
        scopes the user approves.
      </P>
      <P>
        For client-specific setup, available tools, permission scopes and the exact human-approval
        boundary, use the{" "}
        <a href="/docs/integrations/claude-connector" className="text-neon hover:underline">
          Claude connector guide
        </a>
        .
      </P>

      <H2 id="agent-keys">Registering your own agent</H2>
      <P>
        An application can register an agent&apos;s public key through{" "}
        <Code>POST /api/agents/keys</Code>. Authenticated registration binds that key to the
        account and can attach per-transaction limits, a daily budget and allowed categories.
        These controls limit authorized actions; they do not enable a disabled payment rail.
      </P>

      <H2 id="tool-boundaries">Read, prepare and execute are different</H2>
      <UL>
        <LI>Read tools return information covered by the granted scope.</LI>
        <LI>Prepare tools can create a quote, intent or approval link without moving funds.</LI>
        <LI>Execution requires the applicable user authorization and a currently enabled rail.</LI>
        <LI>Travel search and market data do not imply live booking or brokerage execution.</LI>
      </UL>

      <H2 id="availability">Check service availability</H2>
      <P>
        Before exposing an agent tool that may move funds, check <Code>/api/rails</Code> and the{" "}
        <a href="/docs" className="text-neon hover:underline">service availability overview</a>.
        Treat an unavailable or unknown status as a reason to stop, not as permission to proceed.
      </P>

      <DocPager pathname="/docs/integrations/ai-assistants" />
    </article>
  );
}
