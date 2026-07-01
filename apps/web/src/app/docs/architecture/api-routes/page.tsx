import { DocTitle, Lead, H2, P, Code, CodeBlock, EndpointTable, Callout, DocPager } from "@/components/docs/prose";

export const metadata = { title: "Furlpay Docs — API Routes" };

export default function ApiRoutesPage() {
  return (
    <article>
      <DocTitle eyebrow="Architecture">API Routes</DocTitle>
      <Lead>
        The API surface lives under <Code>apps/web/src/app/api</Code> as Next.js route handlers. Every
        request body is validated with zod; every mutation is written through the double-entry ledger.
      </Lead>

      <H2 id="auth">Authentication</H2>
      <EndpointTable
        rows={[
          { method: "POST", path: "/api/auth/webauthn", desc: "Register / authenticate a passkey (FIDO2)" },
          { method: "POST", path: "/api/auth/otp/start", desc: "Send a phone / email OTP (Twilio Verify)" },
          { method: "POST", path: "/api/auth/google", desc: "Sign in with Google Identity Services" },
        ]}
      />

      <H2 id="cards">Cards</H2>
      <EndpointTable
        rows={[
          { method: "POST", path: "/api/cards", desc: "Issue a 2-of-2 MPC virtual card" },
          { method: "POST", path: "/api/cards/settings", desc: "Freeze, set limits, update controls" },
        ]}
      />
      <CodeBlock lang="bash">{`curl -X POST https://furlpay.app/api/cards/settings \\
  -H "Authorization: Bearer sk_live_…" \\
  -d '{ "cardId": "card_1a2b", "frozen": true, "spendLimit": 25000 }'`}</CodeBlock>

      <H2 id="investing">Investing &amp; market data</H2>
      <EndpointTable
        rows={[
          { method: "POST", path: "/api/investing/order", desc: "Fractional stock / ETF order (Alpaca)" },
          { method: "GET", path: "/api/investing/portfolio", desc: "Holdings, cost basis and P/L" },
        ]}
      />
      <P>
        Quotes and fundamentals are sourced from the <Code>Twelve Data API</Code>; real-time execution and
        price streams run over <Code>Alpaca WebSockets</Code>.
      </P>

      <H2 id="agentic">Agentic payments (x402)</H2>
      <P>
        Furlpay speaks <Code>x402</Code> — the HTTP 402 &quot;Payment Required&quot; protocol — so AI agents
        and API clients pay per-request in USDC with no account or key. An unpaid request returns a signed
        quote; the client pays and retries with an <Code>X-PAYMENT</Code> header.
      </P>
      <EndpointTable
        rows={[
          { method: "GET", path: "/api/x402/fx", desc: "Pay-per-call mid-market FX quote ($0.01 USDC)" },
        ]}
      />
      <CodeBlock lang="bash">{`# 1. unpaid request → 402 with a payment quote
curl -i https://furlpay.com/api/x402/fx?from=USD&to=EUR&amount=100

# 2. sign the EIP-3009 authorization, then retry with the payment attached
curl https://furlpay.com/api/x402/fx?from=USD&to=EUR&amount=100 \\
  -H "X-PAYMENT: $(base64_payload)"   # → 200 + X-PAYMENT-RESPONSE receipt`}</CodeBlock>
      <P>
        Verification is hardened against the authorization, binding, replay, and web-layer attack classes
        documented in 2026 x402 research. See{" "}
        <Code>/docs/payments/agentic-x402</Code> for the full flow.
      </P>

      <H2 id="actions">Solana Actions &amp; Blinks</H2>
      <P>
        Shareable checkout links unfurl into signable payment widgets on X, Discord, and any Blink client.
      </P>
      <EndpointTable
        rows={[
          { method: "GET", path: "/actions.json", desc: "Blink client discovery rules" },
          { method: "GET", path: "/api/actions/pay/[orderId]", desc: "Blink metadata (icon, label, buttons)" },
          { method: "POST", path: "/api/actions/pay/[orderId]", desc: "Return the base64 SOL/USDC transaction to sign" },
        ]}
      />

      <H2 id="webhooks">Webhooks &amp; signature verification</H2>
      <EndpointTable
        rows={[
          { method: "POST", path: "/api/webhooks/marqeta", desc: "Card processor events" },
          { method: "POST", path: "/api/webhooks/bridge", desc: "On/off-ramp settlement events" },
          { method: "POST", path: "/api/webhooks/wise", desc: "Local bank account events" },
        ]}
      />
      <P>
        Every webhook carries a <Code>Furlpay-Signature</Code> header. Verify it against your endpoint
        secret before acting on the payload.
      </P>
      <CodeBlock lang="typescript">{`import { Furlpay } from '@furlpay/furlpay-node';

export async function POST(req: Request) {
  const raw = await req.text();
  const event = Furlpay.webhooks.constructEvent(
    raw,
    req.headers.get('furlpay-signature'),
    process.env.FURLPAY_ENDPOINT_SECRET!,
  );
  // event is now trusted — handle event.type
}`}</CodeBlock>

      <Callout title="Idempotency">
        Send an <Code>Idempotency-Key</Code> header on POSTs so retries never double-issue a card or
        double-place an order.
      </Callout>

      <DocPager pathname="/docs/architecture/api-routes" />
    </article>
  );
}
