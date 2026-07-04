import { DocTitle, Lead, H2, P, UL, LI, Code, CodeBlock, Callout, DocPager } from "@/components/docs/prose";

export const metadata = { title: "Furlpay Docs — Quickstart" };

export default function QuickstartPage() {
  return (
    <article>
      <DocTitle eyebrow="Getting Started">Quickstart</DocTitle>
      <Lead>Go from an empty folder to a live, webhook-driven integration in under five minutes.</Lead>

      <H2 id="cli">1. Install the CLI</H2>
      <P>
        The <Code>@furlpay/cli</Code> scaffolds projects, tails logs and forwards webhooks. Run it with
        <Code>npx</Code> or install it globally.
      </P>
      <CodeBlock lang="bash">{`npm i -g @furlpay/cli

furlpay login          # opens a browser to authorize the CLI
furlpay init my-app    # scaffold a Next.js + @furlpay/node project`}</CodeBlock>

      <H2 id="server">2. Make your first call</H2>
      <CodeBlock lang="typescript">{`import { Furlpay } from '@furlpay/node';

const client = new Furlpay(process.env.FURLPAY_SECRET_KEY!);

const order = await client.investing.order({
  symbol: 'AAPL',
  side: 'buy',
  notional: 25_00, // $25.00 in minor units — fractional via Alpaca
});`}</CodeBlock>

      <H2 id="listen">3. Forward webhooks with <Code>furlpay listen</Code></H2>
      <P>
        During development, forward live events to your local server. The CLI prints a signing secret so
        you can verify payloads.
      </P>
      <CodeBlock lang="bash">{`furlpay listen --forward-to localhost:3000/api/webhooks/furlpay

# ready — forwarding events
# whsec_… (use this to verify signatures)`}</CodeBlock>

      <H2 id="elements">4. Drop in the checkout widget</H2>
      <P>
        Add stablecoin checkout to any React app with the <Code>FurlpayCheckoutButton</Code> Element from
        <Code>@furlpay/react</Code>.
      </P>
      <CodeBlock lang="tsx">{`import { FurlpayCheckoutButton } from '@furlpay/react';

<FurlpayCheckoutButton
  amount={49_99}
  currency="USDC"
  onSuccess={(tx) => console.log('settled', tx.id)}
/>;`}</CodeBlock>

      <Callout title="Verify every webhook">
        Always check the <Code>Furlpay-Signature</Code> header before trusting an event. See{" "}
        <a href="/docs/architecture/api-routes#webhooks" className="text-neon hover:underline">
          API Routes → Webhooks
        </a>{" "}
        for the HMAC verification snippet.
      </Callout>

      <UL>
        <LI>Explore every endpoint in <a href="/docs/architecture/api-routes" className="text-neon hover:underline">API Routes</a>.</LI>
        <LI>Understand the repo in <a href="/docs/architecture/monorepo" className="text-neon hover:underline">Monorepo</a>.</LI>
      </UL>

      <DocPager pathname="/docs/quickstart" />
    </article>
  );
}
