import { DocTitle, Lead, H2, P, UL, LI, Code, CodeBlock, Callout, DocPager, Mermaid } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs");

export default function IntroductionPage() {
  return (
    <article>
      <DocTitle eyebrow="Getting Started">Furlpay Developer Quickstart</DocTitle>
      <Lead>
        Welcome to the Furlpay API. Integrate global stablecoin checkouts and fractional stock
        investments with a few lines of code — on a compliance-aware, phishing-resistant, zero-gas rail.
      </Lead>

      <P>
        Furlpay is an on-chain financial operating system: stablecoin payments, local bank accounts,
        card issuance and fractional investing behind one API and a set of typed SDKs. Everything you can
        do in the app, you can do programmatically.
      </P>

      <CodeBlock lang="typescript">{`import { Furlpay } from '@furlpay/node';

const client = new Furlpay('sk_test_123');

const card = await client.cards.issue({
  holder: 'usr_9f2c31',
  currency: 'USDC',
  spendLimit: 500_00, // minor units
});`}</CodeBlock>

      <H2 id="system">The system at a glance</H2>
      <P>
        Every client — human or agent — hits the same Next.js API surface; payments settle
        non-custodially on public chains, with durable state split between Postgres and Redis:
      </P>
      <Mermaid
        caption="System context: clients, payment rails, platform services, state, and external networks."
        chart={`graph TB
    subgraph Clients
        AGENT[AI Agent]
        EXT[Browser Extension]
        WEB[Web App / Mobile]
    end

    subgraph Platform[Furlpay Platform]
        GW[API Gateway - Next.js + middleware]
        subgraph Rails[Payment rails]
            X402[x402 Facilitator - EIP-3009]
            MPP[MPP Handler]
            CCTP[CCTP V2 cross-chain]
            LIFI[LI.FI swaps]
        end
        subgraph Services
            AUTH[Auth - WebAuthn + sessions]
            OPS[Ops control plane + event ledger]
            TRUST[Agent trust and spend mandates]
        end
        SUPA[(Supabase Postgres)]
        REDIS[(Upstash Redis)]
    end

    subgraph Networks[External networks]
        ARB[Arbitrum One]
        BASE[Base]
        SOL[Solana]
        CIRCLE[Circle attestation]
    end

    AGENT --> GW
    EXT --> GW
    WEB --> GW
    GW --> X402
    GW --> MPP
    GW --> CCTP
    GW --> LIFI
    GW --> AUTH
    GW --> OPS
    GW --> TRUST
    X402 --> ARB
    MPP --> ARB
    LIFI --> BASE
    LIFI --> SOL
    CCTP --> CIRCLE
    Rails --> SUPA
    Rails --> REDIS`}
      />

      <H2 id="what">What you can build</H2>
      <UL>
        <LI>Accept stablecoin checkouts with the <Code>FurlpayCheckoutButton</Code> React Element.</LI>
        <LI>Issue virtual cards and control them via <Code>POST /api/cards/settings</Code>.</LI>
        <LI>Open local IBAN / routing accounts and move money across rails.</LI>
        <LI>Place fractional stock &amp; ETF orders via <Code>POST /api/investing/order</Code>.</LI>
        <LI>
          Give an AI agent a wallet — MCP server, LangChain tools, x402 pay-per-call and TAP-style spend
          mandates. Start at{" "}
          <a href="/docs/agents" className="text-neon hover:underline">For AI Agents</a>.
        </LI>
      </UL>

      <H2 id="keys">API keys</H2>
      <P>
        Test keys are prefixed <Code>sk_test_</Code> and live keys <Code>sk_live_</Code>. Keep secret keys
        server-side only; the browser never sees them. Publishable keys (<Code>pk_</Code>) render Elements
        and are safe to expose.
      </P>

      <Callout title="Next: install the CLI">
        The fastest path from zero to a live webhook is the Furlpay CLI. Head to the{" "}
        <a href="/docs/quickstart" className="text-neon hover:underline">Quickstart</a> to scaffold a
        project and forward events to localhost.
      </Callout>

      <DocPager pathname="/docs" />
    </article>
  );
}
