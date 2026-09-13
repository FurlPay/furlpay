import { DocTitle, Lead, H2, P, UL, LI, Code, CodeBlock, EndpointTable, Callout, DocPager, Mermaid } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/architecture/api-routes");

export default function ApiRoutesPage() {
  return (
    <article>
      <DocTitle eyebrow="Architecture">API Routes</DocTitle>
      <Lead>
        The API surface lives under <Code>apps/web/src/app/api</Code> as Next.js route handlers. Every
        request body is validated with zod; every mutation is written through the double-entry ledger.
      </Lead>

      <H2 id="lifecycle">Request lifecycle</H2>
      <P>
        Every request passes the same gauntlet before its handler runs — and money-moving routes add
        rail pause checks, per-transaction caps, and idempotency on top:
      </P>
      <Mermaid
        caption="One request, in order: edge middleware, session, zod validation, route guards, handler, ledger + ops events."
        chart={`flowchart TB
    REQ[Incoming request] --> MW[Middleware - baseline rate limit + session gate]
    MW -->|no session on protected route| R401[401 Unauthorized]
    MW --> VAL[Zod body validation - 100KB cap]
    VAL -->|invalid| R400[400 Bad Request]
    VAL --> AUTHZ[requireUser / requireRole - roles from the user record]
    AUTHZ -->|forbidden| R403[403 Forbidden]
    AUTHZ --> GUARDS[Money guards - rail pause, per-tx caps, idempotency]
    GUARDS -->|rail paused| R503[503 rail_paused]
    GUARDS --> HANDLER[Route handler]
    HANDLER --> LEDGER[Double-entry ledger write]
    HANDLER --> OPS[Ops event ledger - durable, append-only]
    HANDLER --> RES[Typed JSON response]`}
      />

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
          { method: "POST", path: "/api/cards", desc: "Issue a virtual card" },
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

      <H2 id="payments">USDC payments &amp; compliance review</H2>
      <P>
        The unified USDC payment service settles on Arbitrum One (0.5% fee vs 1.5–3.5% card interchange).
        The flow is <Code>create</Code> (quote + EIP-712 sign data) → <Code>execute</Code> (signature →
        settle); both legs are OFAC-screened before anything touches the chain.
      </P>
      <EndpointTable
        rows={[
          { method: "POST", path: "/api/payments/create", desc: "Create a USDC payment intent (honors Idempotency-Key)" },
          { method: "POST", path: "/api/payments/execute", desc: "Submit the EIP-712 signature and settle" },
          { method: "GET", path: "/api/payments/:id", desc: "Poll payment status" },
          { method: "GET", path: "/api/payments/review", desc: "Human-in-the-loop review queue (session-gated)" },
          { method: "POST", path: "/api/payments/review", desc: "Approve / reject a paused payment (session-gated)" },
        ]}
      />
      <P>
        <b>Idempotency.</b> <Code>create</Code> honors an <Code>Idempotency-Key</Code> header — a retry
        with the same key returns the same intent (HTTP 200 with <Code>replayed: true</Code>) instead of
        minting a duplicate. This is the retry-storm guard: agents that resubmit after a dropped receipt,
        or fan-outs of sub-agents sharing a coordinated key, never generate a double charge.{" "}
        <Code>execute</Code> is idempotent too — a retry against an already-settled payment replays the
        original receipt rather than erroring.
      </P>
      <P>
        <b>Human-in-the-loop (HITL) compliance gateway.</b> A payment that clears sanctions screening but
        crosses a regulatory threshold does not settle automatically — it pauses at{" "}
        <Code>pending_review</Code> and <Code>execute</Code> returns <Code>202 Accepted</Code>. A payment
        pauses when:
      </P>
      <UL>
        <LI>its value is at or above <Code>FURLPAY_HITL_THRESHOLD_USD</Code> (default $3,000), or</LI>
        <LI>either counterparty screens as elevated risk, or</LI>
        <LI>its <Code>metadata.jurisdiction</Code> is in <Code>FURLPAY_HIGH_RISK_JURISDICTIONS</Code>.</LI>
      </UL>
      <P>
        The compliance inbox is notified, and a human officer approves or rejects via{" "}
        <Code>/api/payments/review</Code> (session-gated, so the decision is always attributable to a
        person) before funds move on-chain. Agents research and flag; humans make the final call.
      </P>
      <CodeBlock lang="bash">{`# create with an idempotency key (safe to retry verbatim)
curl -X POST https://furlpay.com/api/payments/create \\
  -H "content-type: application/json" \\
  -H "Idempotency-Key: sess_9f3c-booking-42" \\
  -d '{ "amount": 5000, "recipient": "0xabc…", "metadata": { "jurisdiction": "US" } }'

# execute → 202 pending_human_review when it crosses the $3k threshold
# officer approves it:
curl -X POST https://furlpay.com/api/payments/review \\
  -H "content-type: application/json" \\
  --cookie "furlpay_session=…" \\
  -d '{ "paymentId": "pay_…", "decision": "approve" }'`}</CodeBlock>

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
          { method: "POST", path: "/api/webhooks/card-auth", desc: "Card authorization / 3DS2 events" },
          { method: "POST", path: "/api/webhooks/deposit-detect", desc: "On-chain deposit activity" },
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
