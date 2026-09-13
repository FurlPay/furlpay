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
  EndpointTable,
  DocPager,
} from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/payments/solana-actions");

export default function SolanaActionsPage() {
  return (
    <article>
      <DocTitle eyebrow="Payments">Solana Actions &amp; Blinks</DocTitle>
      <Lead>
        Turn any Furlpay checkout into a shareable link that unfurls into a signable payment widget — a{" "}
        <b>Blink</b> — on X, Discord, or any Blink-aware client. Built on the Solana Actions specification.
      </Lead>

      <H2 id="endpoints">Endpoints</H2>
      <EndpointTable
        rows={[
          { method: "GET", path: "/actions.json", desc: "Discovery rules mapping /pay/* → the Action API" },
          { method: "GET", path: "/api/actions/pay/[orderId]", desc: "Blink metadata: icon, title, pay buttons" },
          { method: "POST", path: "/api/actions/pay/[orderId]?asset=USDC|SOL|FURL", desc: "Base64 transfer transaction to sign (FURL only when FURL pricing is configured)" },
          { method: "OPTIONS", path: "/api/actions/*", desc: "CORS preflight for Blink clients" },
        ]}
      />

      <H2 id="correct">Spec-correct by construction</H2>
      <P>These are the details most implementations get wrong — and Furlpay handles them:</P>
      <UL>
        <LI><b>Dollar-denominated amounts</b> — the SOL path converts via a live SOL/USD price rather than charging &quot;25 SOL&quot; for a $25 order.</LI>
        <LI><b>Idempotent merchant ATA creation</b> — the first payment to a fresh token account doesn&apos;t fail.</LI>
        <LI><b><Code>transferChecked</Code></b> — validates mint + decimals on-chain, not a bare transfer.</LI>
        <LI><b>Full header set</b> — <Code>ACTIONS_CORS_HEADERS</Code> plus <Code>X-Action-Version</Code> and <Code>X-Blockchain-Ids</Code> (sRFC 31), and an <Code>OPTIONS</Code> handler so Blinks render.</LI>
      </UL>

      <H2 id="try">Try it</H2>
      <CodeBlock lang="bash">{`# metadata a Blink client reads to render the widget
curl https://furlpay.com/api/actions/pay/order_9f21

# then paste that URL into https://dial.to to render the Blink`}</CodeBlock>

      <Callout title="Starter template">
        A standalone Next.js starter is open-sourced at{" "}
        <Code>github.com/FurlPay/furlpay-solana-actions-template</Code> — clone it to ship spec-correct
        Blinks in minutes.
      </Callout>

      <DocPager pathname="/docs/payments/solana-actions" />
    </article>
  );
}
