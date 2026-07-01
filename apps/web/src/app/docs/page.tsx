import { DocTitle, Lead, H2, P, UL, LI, Code, CodeBlock, Callout, DocPager } from "@/components/docs/prose";

export const metadata = { title: "Furlpay Docs — Introduction" };

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

      <H2 id="what">What you can build</H2>
      <UL>
        <LI>Accept stablecoin checkouts with the <Code>FurlpayCheckoutButton</Code> React Element.</LI>
        <LI>Issue 2-of-2 MPC virtual cards and control them via <Code>POST /api/cards/settings</Code>.</LI>
        <LI>Open local IBAN / routing accounts and move money across rails.</LI>
        <LI>Place fractional stock &amp; ETF orders via <Code>POST /api/investing/order</Code>.</LI>
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
