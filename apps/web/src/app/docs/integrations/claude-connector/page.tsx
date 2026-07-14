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
        Connect your FurlPay account to Claude and ask about your money in plain language — balances across
        chains, spending, transactions, travel. Claude can also <b>prepare</b> payments and bookings, but it can
        never send money on its own: every financial action produces an approval link that <b>you</b> confirm
        with your passkey.
      </Lead>

      <Callout type="info" title="The one thing to know">
        <b>Claude cannot autonomously move money through FurlPay.</b> Money-moving tools create an intent and
        return a secure approval link. Settlement happens only after a human authenticates with a passkey in
        FurlPay. There is no tool, and no scope, that settles funds from a chat message.
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

      <H2 id="tools">What Claude can do (12 tools)</H2>
      <P>
        <b>Read-only</b> — answer questions, never change anything:
      </P>
      <UL>
        <LI>
          <Code>get_financial_overview</Code> — balances, recent transactions and cards in one summary.
        </LI>
        <LI>
          <Code>get_wallet_balances</Code> — stablecoin balances per token and chain, with USD values.
        </LI>
        <LI>
          <Code>list_transactions</Code> — recent transactions, filterable by category.
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
          <Code>search_travel</Code> — stays payable in stablecoins.
        </LI>
        <LI>
          <Code>list_trips</Code> — your upcoming, past and cancelled trips.
        </LI>
      </UL>
      <P>
        <b>Prepare-only</b> — draft an action for you to approve; they change no balances by themselves:
      </P>
      <UL>
        <LI>
          <Code>prepare_payment</Code> — drafts a USDC payment and returns an approval link. Capped at $10,000
          per action through the connector. <b>Does not send.</b>
        </LI>
        <LI>
          <Code>book_travel_link</Code> — returns a link where you complete and pay for a booking yourself.{" "}
          <b>Does not book or charge.</b>
        </LI>
        <LI>
          <Code>create_invoice</Code> — creates a payment request others can pay you. Receives money; never
          sends it.
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
          <Code>travel:read</Code> — your trips and available stays.
        </LI>
        <LI>
          <Code>payments:write</Code> — <b>prepare</b> payments and invoices for your approval. Not settlement.
        </LI>
        <LI>
          <Code>travel:write</Code> — <b>prepare</b> bookings for your approval. Not booking or charging.
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
          <b>Human-in-the-loop for money.</b> Financial tools return an approval link, never a settlement.
          Approval requires a passkey/biometric on your device.
        </LI>
        <LI>
          <b>Same guardrails as the apps.</b> The connector calls FurlPay&apos;s own API routes as you — the
          same validation, rate limits, ownership checks and audit trail as the web and mobile apps. Every
          consent grant and token issue is audited.
        </LI>
        <LI>
          <b>Scoped, short-lived tokens.</b> Connector tokens are distinct from browser sessions: a stolen web
          cookie cannot be used as a connector credential, and vice versa.
        </LI>
      </UL>

      <H2 id="disconnect">Disconnect and revoke</H2>
      <P>
        Remove the connector in Claude (<b>Settings → Connectors → FurlPay → Remove</b>). Access tokens are
        short-lived and expire on their own; removing the connector stops new ones from being issued. To cut
        access immediately from FurlPay&apos;s side, change your password or lock your account in{" "}
        <b>Settings → Security</b>, which invalidates existing sessions and connector tokens.
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
