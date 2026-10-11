import { DocTitle, Lead, H2, H3, P, UL, LI, Code, CodeBlock, Callout, EndpointTable, ParameterTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/payments/merchant-payments");

export default function MerchantPaymentsPage() {
  return (
    <article>
      <DocTitle eyebrow="Payments">Merchant payments: links, invoices and hosted checkout</DocTitle>
      <Lead>
        A merchant creates a payment link, an invoice or a terminal request for an exact USDC
        amount. The payer opens a hosted checkout, chooses a network and sends native USDC from
        their own wallet to a destination reserved for that one checkout. FurlPay marks the payment
        paid only after it has read the transfer back from the chain.
      </Lead>

      <Callout type="warning" title="Availability depends on deployment setup">
        This flow is implemented, but it is not switched on by the code alone. It needs the payment
        database migration, collection destinations provisioned by operations for each merchant and
        network, and a working node endpoint per network. Until those exist the API answers{" "}
        <Code>503</Code> and no payment is requested from the payer. See{" "}
        <a href="#setup" className="text-neon hover:underline">Setup</a>.
      </Callout>

      <H2 id="objects">What a merchant can create</H2>
      <ParameterTable
        params={[
          { name: "link", type: "kind", required: true, desc: "A payment link for a fixed amount. May be reusable (many payers) or single-use." },
          { name: "invoice", type: "kind", required: true, desc: "Single-use, with 1 to 50 line items. The total must equal the sum of quantity × unit price." },
          { name: "terminal", type: "kind", required: true, desc: "Single-use request shown as a QR code at a point of sale." },
        ]}
      />
      <P>
        Amounts are decimal strings with up to six decimals, above zero and at most 1,000,000 USDC.
        They are stored as integer micro-units; no floating-point arithmetic touches a payment
        amount.
      </P>

      <H2 id="networks">Networks and confirmation depth</H2>
      <P>
        Only Circle-issued native USDC is accepted. A link lists the networks the merchant allows;
        the checkout offers the subset that currently has an unassigned destination for that
        merchant (<Code>readyChains</Code>).
      </P>
      <ParameterTable
        params={[
          { name: "Base", type: "1 confirmation", required: true, desc: "Chain ID 8453." },
          { name: "Arbitrum", type: "1 confirmation", required: true, desc: "Chain ID 42161." },
          { name: "OP Mainnet", type: "1 confirmation", required: true, desc: "Chain ID 10." },
          { name: "Avalanche", type: "1 confirmation", required: true, desc: "Chain ID 43114." },
          { name: "Ethereum", type: "12 confirmations", required: true, desc: "Chain ID 1." },
          { name: "Polygon", type: "128 confirmations", required: true, desc: "Chain ID 137." },
          { name: "Solana", type: "finalized", required: true, desc: "Matched by a one-time reference key included in the transfer." },
          { name: "Arc", type: "1 confirmation", required: false, desc: "Declared in the registry (chain ID 5042). Requires ARC_RPC_URL and a provisioned destination." },
          { name: "Sui", type: "not enabled", required: false, desc: "Declared in the registry, but this build has no Sui transfer verifier, so a Sui checkout cannot be reserved." },
        ]}
      />

      <H2 id="pricing">Fees</H2>
      <P>
        Each link records a processing rate of 75 basis points when it is created. The fee is
        rounded down to the smallest USDC unit. The merchant chooses who pays it:
      </P>
      <UL>
        <LI><b>Merchant pays</b> — the payer is charged the gross amount; the merchant nets gross minus fee.</LI>
        <LI><b>Customer pays</b> — the payer is charged gross plus fee; the merchant nets the gross amount.</LI>
      </UL>
      <P>Network gas is separate and is always paid by the payer&apos;s wallet.</P>

      <H2 id="flow">Checkout flow</H2>
      <UL>
        <LI>The merchant creates a link. The response contains a 24-character opaque slug; the hosted page is <Code>/p/&lt;slug&gt;</Code>.</LI>
        <LI>The payer picks a network. FurlPay reserves one never-reused destination address for this checkout and records the chain height at that moment.</LI>
        <LI>The checkout shows a payment URI and QR code: an EIP-681 <Code>ethereum:</Code> transfer request on EVM networks, a Solana Pay URI on Solana.</LI>
        <LI>While the page is open it polls the checkout endpoint, which runs the verifier. A scheduled scanner runs the same verifier as a fallback.</LI>
        <LI>When the required confirmation depth is reached and screening passes, the receipt, ledger posting, status change and webhook event are committed together.</LI>
      </UL>

      <H3 id="statuses">Payment statuses</H3>
      <ParameterTable
        params={[
          { name: "awaiting_payment", type: "status", required: true, desc: "Destination reserved; no qualifying transfer seen." },
          { name: "confirming", type: "status", required: true, desc: "A transfer was seen but has not reached the required depth." },
          { name: "underpaid", type: "status", required: true, desc: "Less than the charge has been received; the checkout shows the remaining amount." },
          { name: "paid", type: "status", required: true, desc: "The exact charge was received and verified." },
          { name: "overpaid", type: "status", required: true, desc: "More than the charge was received. Treated as paid; the excess is recorded." },
          { name: "expired", type: "status", required: true, desc: "The checkout window closed without full payment." },
          { name: "review", type: "status", required: true, desc: "Held for manual review: a screening result that is not an allow, or a transfer timestamped outside the checkout window." },
        ]}
      />

      <H2 id="verification">How a payment is verified</H2>
      <P>
        The client never reports a payment. On EVM networks the verifier reads USDC{" "}
        <Code>Transfer</Code> logs to the reserved address, fetches the transaction receipt
        independently, checks that the log is present in it with the same data and block hash, and
        re-reads the block to detect a reorganisation. It also checks the chain ID, that the node
        head is fresh (within 120 seconds) and that the token reports six decimals.
      </P>
      <P>
        Before crediting, the payer and the destination are screened (see{" "}
        <a href="/docs/compliance/screening" className="text-neon hover:underline">Screening and cases</a>)
        and checked against the USDC issuer&apos;s on-chain blocklist. If a node is unreachable the
        checkout keeps its last proven state and reports <Code>verificationDelayed: true</Code>; an
        outage is never turned into a success or a failure.
      </P>

      <H2 id="api">API</H2>
      <EndpointTable
        rows={[
          { method: "GET", path: "/api/merchant/payments", desc: "Signed-in merchant: links, payment intents and readyChains. ?id=<uuid> returns one payment with its events and receipts" },
          { method: "POST", path: "/api/merchant/payments", desc: "Create a link, invoice or terminal request. Idempotent on requestId" },
          { method: "PATCH", path: "/api/merchant/payments", desc: "Activate or deactivate a link: { id, active }" },
          { method: "GET", path: "/api/checkout/merchant/{slug}", desc: "Public: link details and readyChains; ?intent=<uuid> returns checkout status and runs verification" },
          { method: "POST", path: "/api/checkout/merchant/{slug}", desc: "Public: reserve a checkout on one network: { requestId, chain }" },
        ]}
      />
      <CodeBlock lang="bash" filename="Create a payment link">{`curl -X POST https://furlpay.com/api/merchant/payments \\
  -H "content-type: application/json" \\
  -b "session" \\
  -d '{
    "requestId": "7d0a5c4e-2c1b-4b7e-9a51-3f2d6c8e1a90",
    "kind": "link",
    "title": "Annual plan",
    "description": "",
    "amount": "250.00",
    "chains": ["base", "arbitrum"],
    "reusable": false,
    "feePayer": "merchant",
    "expiresAt": null,
    "reference": "ORDER-1042",
    "lines": []
  }'`}</CodeBlock>
      <P>
        Every field in the body is required and unknown fields are rejected. Merchant routes use the
        signed-in session; the merchant is always the authenticated account and no merchant ID is
        accepted from the client. The public checkout routes are rate limited per IP (90 reads and
        10 reservations per minute).
      </P>

      <H3 id="errors">Responses to handle</H3>
      <UL>
        <LI><Code>409</Code> on reserve — the link is closed, or a single-use checkout is already in progress.</LI>
        <LI><Code>503</Code> on reserve — the network is not ready (no destination, or the node could not be verified). No payment was requested.</LI>
        <LI><Code>503</Code> on merchant routes — payment storage is not configured or the migration is not applied.</LI>
      </UL>

      <H2 id="webhooks">Webhook events</H2>
      <P>
        A verified payment writes <Code>payment.succeeded</Code> to the merchant&apos;s outbox, and{" "}
        <Code>invoice.paid</Code> when the link is an invoice. Delivery, signature format and retry
        schedule are described in{" "}
        <a href="/docs/architecture/webhooks#merchant-events" className="text-neon hover:underline">Webhook Events</a>.
        The webhook is a notification; the payment record returned by the API is the source of truth.
      </P>

      <H2 id="workspace">Where merchants manage this</H2>
      <UL>
        <LI><Code>/dashboard/payments</Code>, <Code>/dashboard/payment-links</Code>, <Code>/dashboard/invoices</Code> and <Code>/dashboard/qr</Code> — the merchant workspace (sign-in required).</LI>
        <LI><Code>/p/&lt;slug&gt;</Code> — the public hosted checkout for one link.</LI>
      </UL>

      <H2 id="setup">Setup</H2>
      <UL>
        <LI><b>Database</b> — <Code>SUPABASE_URL</Code> and <Code>SUPABASE_SERVICE_ROLE_KEY</Code>, with migration <Code>0040_stablecoin_payments</Code> applied (and <Code>0041_merchant_webhooks</Code> for webhooks).</LI>
        <LI><b>Destinations</b> — operations must insert approved, platform-controlled collection addresses into <Code>merchant_payment_destinations</Code> for each merchant and network. Each address is used for exactly one checkout. When none is free the reserve call returns 503; there is no fallback to a shared address.</LI>
        <LI><b>Node endpoints</b> — <Code>BASE_RPC_URL</Code>, <Code>ARBITRUM_RPC_URL</Code>, <Code>ETHEREUM_RPC_URL</Code>, <Code>POLYGON_RPC_URL</Code>, <Code>SOLANA_RPC_URL</Code>, <Code>ARC_RPC_URL</Code>. Unset values fall back to public endpoints, which are rate limited and not suitable for production volume.</LI>
        <LI><b>Scanner</b> — schedule <Code>GET /api/cron/merchant-payments</Code> with the cron secret. It rescans open checkouts and delivers due webhooks. It is not in the default <Code>vercel.json</Code> cron list, so without a schedule, verification only runs while a checkout page is open and webhooks are not delivered.</LI>
        <LI><b>Webhook secrets</b> — <Code>FURLPAY_PARTNER_WEBHOOK_KEY</Code> (base64 of 32 random bytes) seals merchant signing secrets at rest.</LI>
      </UL>

      <Callout type="info" title="What this is not">
        Collected funds arrive at platform-controlled destinations and are recorded in a USDC
        subledger. Paying those balances out to a merchant&apos;s bank account is a separate
        capability that is not available: FurlPay has no contracted banking or off-ramp partner.
      </Callout>

      <DocPager pathname="/docs/payments/merchant-payments" />
    </article>
  );
}
