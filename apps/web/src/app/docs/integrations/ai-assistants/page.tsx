import { DocTitle, Lead, H2, H3, P, UL, LI, Code, CodeBlock, Callout } from "@/components/docs/prose";

export const metadata = { title: "Furlpay Docs — ChatGPT & Claude" };

export default function AiAssistantsPage() {
  return (
    <article>
      <DocTitle eyebrow="Integrations">ChatGPT &amp; Claude</DocTitle>
      <Lead>
        Connect FurlPay to an AI assistant so users can pay in stablecoins, book travel and invest from
        chat. FurlPay ships both surfaces: an OpenAI <b>GPT Action</b> (OpenAPI) and a <b>Model Context
        Protocol</b> (MCP) server for Claude.
      </Lead>

      <Callout>
        FurlPay never lets an assistant move money unattended. Every payment, trade or swap returns
        EIP-712 sign data or a confirmation the human approves before it settles (human-in-the-loop).
      </Callout>

      <H2 id="chatgpt">1. ChatGPT — GPT Action</H2>
      <P>
        FurlPay serves a plugin manifest and an OpenAPI 3.1 spec. In the GPT builder, add an Action and
        import the schema URL:
      </P>
      <UL>
        <LI>Manifest: <Code>https://furlpay.com/.well-known/ai-plugin.json</Code></LI>
        <LI>OpenAPI schema: <Code>https://furlpay.com/openapi.json</Code></LI>
        <LI>Auth: Bearer API key (create one at <Code>/developer</Code>).</LI>
      </UL>
      <P>
        The model then calls tools like <Code>get_wallet_balances</Code>, <Code>quote_swap</Code>,{" "}
        <Code>place_investment_order</Code> and <Code>search_stays</Code> directly. Example prompt:{" "}
        <i>&ldquo;Book a hotel in Tokyo under $200/night and pay with USDC.&rdquo;</i>
      </P>

      <H2 id="claude">2. Claude — MCP server</H2>
      <P>
        FurlPay ships a stdio MCP server (<Code>@furlpay/mcp-server</Code>). Add it to Claude Desktop&rsquo;s
        config so Claude can build on the FurlPay Core API:
      </P>
      <CodeBlock lang="json">{`{
  "mcpServers": {
    "furlpay": {
      "command": "npx",
      "args": ["-y", "@furlpay/mcp-server"],
      "env": {
        "FURLPAY_BASE_URL": "https://api.furlpay.com",
        "FURLPAY_API_KEY": "sk_live_..."
      }
    }
  }
}`}</CodeBlock>
      <P>
        For local development point <Code>FURLPAY_BASE_URL</Code> at{" "}
        <Code>http://localhost:3000</Code> and use a <Code>sk_sandbox_</Code> key. Restart Claude Desktop
        and the FurlPay tools appear in the tool menu.
      </P>

      <H3 id="tools">Available tools</H3>
      <UL>
        <LI><Code>get_wallet_balances</Code> — Safe smart-account stablecoin balances.</LI>
        <LI><Code>quote_swap</Code> — cheapest cross-chain stablecoin route (CCTP V2 / Li.Fi).</LI>
        <LI><Code>place_investment_order</Code> — fractional stock/ETF order.</LI>
        <LI><Code>screen_wallet_risk</Code> — AML screen an address.</LI>
        <LI><Code>verify_identity</Code> — KYC identity check.</LI>
      </UL>

      <H2 id="own-copilot">3. Or use the built-in Co-Pilot</H2>
      <P>
        FurlPay also ships its own assistant at <Code>/chat</Code>, backed by{" "}
        <Code>POST /api/chat</Code>. It runs the same tool surface, is grounded on the user&rsquo;s real
        account state, and returns a confirmation for any money movement. Set{" "}
        <Code>ANTHROPIC_API_KEY</Code> to have Claude phrase replies over the grounded facts; without a
        key it falls back to a deterministic responder.
      </P>
    </article>
  );
}
