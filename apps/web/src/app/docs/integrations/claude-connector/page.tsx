import { DocTitle, Lead, H2, P, UL, LI, Code, CodeBlock, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/integrations/claude-connector");

// The public documentation page the Anthropic directory submission points at.
// Everything here describes behavior that is actually shipped — the tool list is
// generated from the same registry the server serves (lib/mcp/tools.ts), and the
// security model section describes the code, not an aspiration.

export default function ClaudeConnectorPage() {
  return (
    <article>
      <DocTitle eyebrow="Integrations">FurlPay connector for Claude</DocTitle>
      <Lead>
        Connect your FurlPay account to Claude over MCP and grant access to specific account tools.
        Claude can read authorized account data and prepare some actions for review. Payment settlement
        still depends on rail availability, and production travel booking is unavailable.
      </Lead>

      <Callout type="info" title="The one thing to know">
        <b>A tool call is not proof that money moved.</b> Payment tools can prepare an intent or request
        for user review. Production settlement depends on the selected rail being enabled and confirmed.
        Travel links open discovery; FurlPay production travel booking is not currently available.
      </Callout>

      <H2 id="connect">Connect FurlPay to Claude</H2>
      <P>
        In Claude, open <b>Settings → Connectors → Add custom connector</b> and enter the FurlPay MCP endpoint:
      </P>
      <CodeBlock lang="text">{`https://furlpay.com/api/mcp`}</CodeBlock>
      <P>
        Claude discovers the authorization server automatically, registers itself, and sends you to FurlPay to
        sign in and approve access. You choose what to grant on the consent screen. In Claude Code:
      </P>
      <CodeBlock lang="bash">{`claude mcp add --transport http furlpay https://furlpay.com/api/mcp`}</CodeBlock>

      <H2 id="tools">Tools currently defined by the connector</H2>
      <P>
        The MCP server defines the tools below. Claude sees only tools allowed by the scopes you grant,
        and a tool result can still be limited by account data, provider configuration or payment-rail
        availability.
      </P>
      <P>
        <b>Read-only</b> — answer questions, never change anything:
      </P>
      <UL>
        <LI>
          <Code>get_financial_overview</Code> — account overview data returned by the API.
        </LI>
        <LI>
          <Code>get_wallet_balances</Code> — stablecoin balances per token and chain, with USD values.
        </LI>
        <LI>
          <Code>list_transactions</Code> — recent transactions, filterable by category.
        </LI>
        <LI>
          <Code>get_portfolio</Code> — read-only portfolio data when available; this tool does not place trades.
        </LI>
        <LI>
          <Code>get_treasury_insights</Code> — spending by category over a period (burn rate, budgets).
        </LI>
        <LI>
          <Code>get_wallet_risk</Code> — AML/risk screening of a destination address before you pay it.
        </LI>
        <LI>
          <Code>get_swap_quote</Code> — best cross-chain stablecoin route and price (quoting moves nothing).
        </LI>
        <LI>
          <Code>search_travel</Code> — hotel discovery results when a provider returns them; results are not bookable inventory.
        </LI>
        <LI>
          <Code>list_trips</Code> — trip records returned for your account; this does not indicate that FurlPay booking is available.
        </LI>
      </UL>
      <P>
        <b>Prepare-only</b> — draft an action for you to approve; they change no balances by themselves:
      </P>
      <UL>
        <LI>
          <Code>prepare_payment</Code> — prepares a USDC payment for review, subject to the route&apos;s limits
          and authentication. <b>Does not settle by itself.</b>
        </LI>
        <LI>
          <Code>book_travel_link</Code> — opens a travel discovery page. FurlPay production booking and
          payment are unavailable.
        </LI>
        <LI>
          <Code>create_invoice</Code> — creates a payment request. It does not mean a recipient can
          complete settlement through FurlPay.
        </LI>
        <LI>
          <Code>open_support_ticket</Code> — files a support ticket. Seed phrases, private keys and card numbers
          are stripped server-side if pasted.
        </LI>
      </UL>

      <H2 id="scopes">Permissions you grant</H2>
      <UL>
        <LI>
          <Code>profile:read</Code> — your name, email and account status.
        </LI>
        <LI>
          <Code>wallets:read</Code> — balances and address risk screening.
        </LI>
        <LI>
          <Code>transactions:read</Code> — transaction history and spending analytics.
        </LI>
        <LI>
          <Code>travel:read</Code> — trip records and travel discovery data when available.
        </LI>
        <LI>
          <Code>payments:write</Code> — <b>prepare</b> payments and invoices for your approval. Not settlement.
        </LI>
        <LI>
          <Code>travel:write</Code> — opens the travel discovery flow; it does not book or charge.
        </LI>
      </UL>
      <P>
        A connection that doesn&apos;t request a scope cannot even see the tools that need it. If you grant only
        read scopes, the payment tools are not listed to the model at all.
      </P>

      <H2 id="security">Security model</H2>
      <UL>
        <LI>
          <b>OAuth 2.1 with PKCE (S256 only).</b> Claude is a public client — it holds no secret, so the PKCE
          verifier is the proof. Authorization codes are single-use, expire in 5 minutes, and a replay is
          rejected atomically even if it races the original.
        </LI>
        <LI>
          <b>Strict redirect allowlist.</b> Codes are only ever sent to Claude&apos;s official callbacks or a
          loopback address (for CLI clients, whose port is assigned at runtime). Nothing else.
        </LI>
        <LI>
          <b>User review for financial actions.</b> Tools can return an approval link or request, but
          settlement still depends on rail status and the route&apos;s confirmation flow.
        </LI>
        <LI>
          <b>API route checks apply.</b> The connector calls FurlPay's API as the signed-in account
          and is subject to route validation, authorization and rate limits.
        </LI>
        <LI>
          <b>Scoped, short-lived tokens.</b> Connector tokens are distinct from browser sessions: a stolen web
          cookie cannot be used as a connector credential, and vice versa.
        </LI>
      </UL>

      <H2 id="disconnect">Disconnect and revoke</H2>
      <P>
        Remove the connector in Claude (<b>Settings → Connectors → FurlPay → Remove</b>). To revoke
        authorization from FurlPay, use the account's connected-app or security controls if shown,
        or contact support. Do not assume removing a client-side connector instantly revokes every
        previously issued token.
      </P>

      <H2 id="privacy">Privacy, terms and contact</H2>
      <UL>
        <LI>
          Privacy policy: <Code>https://furlpay.com/legal/privacy</Code>
        </LI>
        <LI>
          Terms of service: <Code>https://furlpay.com/legal/terms</Code>
        </LI>
        <LI>
          Support: <Code>support@furlpay.com</Code> — or ask Claude to open a ticket for you.
        </LI>
        <LI>
          Security disclosures: <Code>security@furlpay.com</Code>
        </LI>
      </UL>
      <P>
        FurlPay shares with Claude only what the tools you authorized return. FurlPay never sends your private
        keys, recovery phrase, card numbers or session tokens to any AI client — they are not reachable through
        any tool.
      </P>

      <DocPager pathname="/docs/integrations/claude-connector" />
    </article>
  );
}
