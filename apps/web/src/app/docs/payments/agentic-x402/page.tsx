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
  Mermaid,
} from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/payments/agentic-x402");

export default function AgenticX402Page() {
  return (
    <article>
      <DocTitle eyebrow="Payments">Agentic Payments (x402)</DocTitle>
      <Lead>
        FurlPay implements <b>x402</b> and the Machine Payments Protocol (MPP) for HTTP
        &quot;Payment Required&quot; challenges. On 11 October 2026, the production x402 endpoint
        returned <Code>503 controls_unavailable</Code> with reason <Code>plan_limit</Code>. x402 and
        MPP settlement are also not currently enabled for production payments.
      </Lead>

      <Callout type="warning" title="Protocol support is not settlement availability">
        This guide describes protocol shapes and request formats. The FurlPay x402 endpoint is
        currently unavailable, and no sample exchange is evidence that an agent can pay for a
        resource in production. Check the{" "}
        <a href="/api/rails" className="text-neon hover:underline">live rail registry</a>; if a
        settlement rail is not healthy or its status is unavailable, do not release a paid
        resource.
      </Callout>

      <H2 id="flow">The flow</H2>
      <DepGraph
        caption="Protocol flow. Production settlement is currently gated, so the final paid response is not available as a live FurlPay service."
        layers={[
          { label: "1 · Request", nodes: [{ name: "GET /api/x402/fx", sub: "no payment yet" }] },
          { label: "2 · Quote", accent: true, nodes: [{ name: "402 Payment Required", sub: "signed requirements" }] },
          { label: "3 · Pay & retry", nodes: [{ name: "X-PAYMENT", sub: "sample EIP-3009 authorization" }] },
          { label: "4 · Deliver", nodes: [{ name: "Settlement gated", sub: "not live in production" }] },
        ]}
      />
      <P>
        When a settlement rail is enabled, the intended sequence runs through the facilitator&apos;s
        verification guards before the resource is served. The diagram documents that flow; it is
        not evidence that production settlement is configured:
      </P>
      <Mermaid
        caption="Full x402 settlement sequence: quote binding, atomic nonce claim, EIP-3009 transfer on-chain, confirmation gate, receipt."
        chart={`sequenceDiagram
    participant Agent as AI Agent
    participant Server as Resource Server
    participant Facilitator as Furlpay Facilitator
    participant Chain as Arbitrum

    Agent->>Server: GET /api/x402/fx
    Server-->>Agent: 402 Payment Required (price, payTo, quoteId, binding)
    Note over Agent: Sign EIP-3009 transferWithAuthorization
    Agent->>Server: GET /api/x402/fx + X-PAYMENT header
    Server->>Facilitator: verify + settle
    Facilitator->>Facilitator: Verify quote binding (HMAC)
    Facilitator->>Facilitator: Recover EIP-712 signer (ECDSA / ERC-1271)
    Facilitator->>Facilitator: Claim nonce atomically (replay guard)
    Facilitator->>Chain: transferWithAuthorization()
    Chain-->>Facilitator: receipt after confirmation depth
    Facilitator-->>Server: settlement confirmed
    Server-->>Agent: 200 OK + X-PAYMENT-RESPONSE receipt`}
      />

      <H2 id="quote">1. Request the resource</H2>
      <P>
        When operational controls are available, an unpaid request is intended to return{" "}
        <Code>402</Code> with a machine-readable payment quote. The production endpoint currently
        returns <Code>503</Code>. Any quote fields below are illustrative; use values returned by a
        healthy endpoint and never hardcode a recipient or network:
      </P>
      <CodeBlock lang="bash">{`curl -i "https://furlpay.com/api/x402/fx?from=USD&to=EUR&amount=100"

HTTP/1.1 402 Payment Required
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "<network-from-current-challenge>",
    "maxAmountRequired": "10000",        // 0.01 USDC (6 decimals)
    "asset": "<asset-from-current-challenge>",
    "payTo": "<payTo-from-current-challenge>",
    "resource": "https://furlpay.com/api/x402/fx",
    "extra": { "quoteId": "…", "expiresAt": 1782943200, "binding": "…" }
  }]
}`}</CodeBlock>

      <H2 id="pay">2. Pay and retry</H2>
      <P>
        The protocol client signs an EIP-3009 <Code>transferWithAuthorization</Code> for the quoted
        amount and retries with the base64 payload in the <Code>X-PAYMENT</Code> header. A live
        paid response requires a configured settlement rail; do not treat the example below as a
        response that is available in production today.
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

      <Callout title="Related agent controls">
        Protocol settlement is separate from agent identity and spending policies. See{" "}
        <a href="/docs/payments/agent-trust" className="text-neon underline underline-offset-2">
          Agent Trust &amp; Mandates
        </a>
        {" "}for the controls that apply before a payment action is prepared.
      </Callout>

      <DocPager pathname="/docs/payments/agentic-x402" />
    </article>
  );
}
