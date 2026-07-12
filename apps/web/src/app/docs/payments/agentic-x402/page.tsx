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

export const metadata = docMeta("/docs/payments/agentic-x402");

export default function AgenticX402Page() {
  return (
    <article>
      <DocTitle eyebrow="Payments">Agentic Payments (x402)</DocTitle>
      <Lead>
        The most interesting payments customer of 2026 is an AI agent. Furlpay speaks <b>x402</b> — the
        HTTP 402 &quot;Payment Required&quot; protocol — so any agent or client can pay per request in USDC
        with no account, no API key, and no card on file.
      </Lead>

      <H2 id="flow">The flow</H2>
      <DepGraph
        caption="Request → 402 quote → sign → retry with payment → resource + receipt."
        layers={[
          { label: "1 · Request", nodes: [{ name: "GET /api/x402/fx", sub: "no payment yet" }] },
          { label: "2 · Quote", accent: true, nodes: [{ name: "402 Payment Required", sub: "signed requirements" }] },
          { label: "3 · Pay & retry", nodes: [{ name: "X-PAYMENT", sub: "EIP-3009 authorization" }] },
          { label: "4 · Deliver", nodes: [{ name: "200 OK", sub: "+ X-PAYMENT-RESPONSE receipt" }] },
        ]}
      />

      <H2 id="quote">1. Request the resource</H2>
      <P>An unpaid request returns <Code>402</Code> with a machine-readable payment quote:</P>
      <CodeBlock lang="bash">{`curl -i "https://furlpay.com/api/x402/fx?from=USD&to=EUR&amount=100"

HTTP/1.1 402 Payment Required
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "base",
    "maxAmountRequired": "10000",        // 0.01 USDC (6 decimals)
    "asset": "0x833589fCD6…2913",        // USDC on Base
    "payTo": "0x2096…287C",
    "resource": "https://furlpay.com/api/x402/fx",
    "extra": { "quoteId": "…", "expiresAt": 1782943200, "binding": "…" }
  }]
}`}</CodeBlock>

      <H2 id="pay">2. Pay and retry</H2>
      <P>
        The client signs an EIP-3009 <Code>transferWithAuthorization</Code> for the quoted amount and
        retries with the base64 payload in the <Code>X-PAYMENT</Code> header. On success the resource is
        returned with an <Code>X-PAYMENT-RESPONSE</Code> settlement receipt.
      </P>
      <CodeBlock lang="bash">{`curl "https://furlpay.com/api/x402/fx?from=USD&to=EUR&amount=100" \\
  -H "X-PAYMENT: $(base64_signed_payload)"

HTTP/1.1 200 OK
X-PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVl…
{ "paid": true, "payer": "0x1111…", "quote": { "rate": 0.917, "amountTo": 91.7 } }`}</CodeBlock>

      <H2 id="security">Hardened verification</H2>
      <P>
        With agents, the payment <i>is</i> the authentication — so payment verification is the entire
        security boundary. Furlpay defends the four attack classes from 2026 x402 research
        (arXiv 2605.11781 / 2605.30998):
      </P>
      <UL>
        <LI><b>Authorization</b> — amount, recipient, and network are re-checked server-side; the client&apos;s echoed requirements are never trusted.</LI>
        <LI><b>Binding</b> — each quote carries an HMAC over <Code>(resource, method, amount, expiry)</Code>; a payment for one endpoint fails closed on every other.</LI>
        <LI><b>Replay</b> — quote IDs and nonces are single-use with a 300-second expiry.</LI>
        <LI><b>Web-layer</b> — the header is size-capped and strictly parsed; malformed input returns 400, never a free resource.</LI>
      </UL>

      <Callout title="Standards landscape">
        x402 (Coinbase / Cloudflare, Linux Foundation since April 2026) has by far the most deployed
        traffic, alongside AP2 (Google), MPP (Stripe / Tempo), and TAP (Visa, production-live July 2026).
        Furlpay implements x402 today on Base and Solana, and ships a TAP-aligned trust layer — see{" "}
        <a href="/docs/payments/agent-trust" className="text-neon underline underline-offset-2">
          Agent Trust &amp; Mandates
        </a>
        .
      </Callout>

      <DocPager pathname="/docs/payments/agentic-x402" />
    </article>
  );
}
