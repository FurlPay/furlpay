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

      <Callout type="warning" title="Status: implemented, not production verified">
        The flow is implemented and covered by tests. It is not enabled by code alone: it needs the
        payment migrations applied, collection addresses registered for each merchant and network
        by a custody provider that controls them, and working node endpoints. No custody provider is
        integrated, so production has no collection addresses. Until one exists the reserve call
        answers <Code>503</Code> and no payment is requested from the payer.
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
        Only Circle-issued native USDC is accepted. A network is collectable only when it has a
        reviewed deposit policy; the required depth is the stricter of that policy and the payment
        registry. The checkout offers the networks that currently have an unassigned destination for
        the merchant.
      </P>
      <ParameterTable
        params={[
          { name: "Base", type: "1 confirmation", required: true, desc: "Mainnet, chain ID 8453." },
          { name: "Arbitrum", type: "1 confirmation", required: true, desc: "Mainnet, chain ID 42161." },
          { name: "Ethereum", type: "12 confirmations", required: true, desc: "Mainnet, chain ID 1." },
          { name: "Polygon", type: "128 confirmations", required: true, desc: "Mainnet, chain ID 137." },
          { name: "Solana", type: "31 confirmations", required: true, desc: "Mainnet. Matched by a one-time reference key included in the transfer." },
          { name: "Arc", type: "1 confirmation", required: true, desc: "Mainnet, chain ID 5042. Receipts are keyed on the network's system-emitter log." },
          { name: "Sui", type: "1 checkpoint", required: true, desc: "Mainnet. Read over GraphQL; a transaction in a certified checkpoint is final." },
          { name: "Arc Testnet", type: "testnet only", required: false, desc: "Chain ID 5042002. Collectable only with FURLPAY_TESTNET_COLLECTION=1 and never in a production environment. Testnet payments book to separate ledger accounts." },
          { name: "OP Mainnet, Avalanche", type: "not collectable", required: false, desc: "Listed in the registry, but they have no deposit policy, so a checkout cannot be reserved on them." },
        ]}
      />

      <H2 id="pricing">Fees</H2>
      <P>
        Each link records the merchant&apos;s processing rate when it is created. Rates are tiers
        assigned by operations: starter 95, growth 75, scale 50 and enterprise 35 basis points. A
        merchant with no assigned tier pays the growth rate. The fee is rounded down to the smallest
        USDC unit. The merchant chooses who pays it:
      </P>
      <UL>
        <LI><b>Merchant pays</b> — the payer is charged the gross amount; the merchant nets gross minus fee.</LI>
        <LI><b>Customer pays</b> — the payer is charged gross plus fee; the merchant nets the gross amount.</LI>
      </UL>
      <P>Network gas is separate and is always paid by the payer&apos;s wallet.</P>

      <H2 id="flow">Checkout flow</H2>
      <UL>
        <LI>The merchant creates a link. The response contains a 24-character opaque slug; the hosted page is <Code>/p/&lt;slug&gt;</Code>. Payers are anonymous and need no account.</LI>
        <LI>The payer picks a network. FurlPay reserves one never-reused destination address for this checkout and records the chain height at that moment.</LI>
        <LI>The checkout shows a payment request and QR code for the payer&apos;s wallet.</LI>
        <LI>While the page is open it polls the checkout endpoint, which runs the verifier. A scheduled job runs the same verifier every two minutes, so confirmation does not depend on the page staying open.</LI>
        <LI>When the required depth is reached and screening passes, the receipt, ledger posting, status change and webhook event are committed together.</LI>
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
          { name: "review", type: "status", required: true, desc: "Held for manual review, for example a screening result that is not an allow." },
        ]}
      />

      <H2 id="verification">How a payment is verified</H2>
      <P>
        The client never reports a payment. The verifier reads the transfer to the reserved address
        from the network, checks it independently against the transaction receipt, confirms the
        network identity and that the node head is fresh, and re-checks that the block is still
        canonical. Before crediting, the payer and the destination are screened (see{" "}
        <a href="/docs/compliance/screening" className="text-neon hover:underline">Screening and cases</a>).
      </P>
      <P>
        If a node is unreachable the checkout keeps its last proven state and reports that
        verification is delayed. An outage is never turned into a success or a failure. A transfer
        is recorded once per network, transaction and log position, so a duplicate scan cannot
        credit twice.
      </P>

      <H2 id="receipts">Receipts</H2>
      <P>
        A one-page PDF receipt is issued only for a payment the verifier credited (paid or
        overpaid). An underpaid, confirming or held payment has no receipt.
      </P>

      <H2 id="refunds">Refunds</H2>
      <P>
        On-chain payments cannot be reversed, so a refund is a new transfer back to the payer.
        Requesting one reserves the amount in the ledger immediately. Operations approve it, and
        the custody provider that controls the collection addresses sends it. The refund is marked
        complete only when that transfer is read on-chain.
      </P>
      <ParameterTable
        params={[
          { name: "requested", type: "status", required: true, desc: "Amount reserved; awaiting operations." },
          { name: "pending_external_execution", type: "status", required: true, desc: "Approved; waiting for the custody provider's transfer." },
          { name: "completed", type: "status", required: true, desc: "The refund transfer was verified on-chain." },
          { name: "cancelled", type: "status", required: true, desc: "Cancelled; the reservation is released." },
        ]}
      />
      <Callout type="info" title="Refund execution is blocked by an external dependency">
        Requesting, approving and verifying refunds is implemented. Sending one requires a custody
        provider, and none is integrated, so a refund cannot currently leave the pending state.
      </Callout>

      <H2 id="reconciliation">Reconciliation and alerts</H2>
      <P>
        Every ten minutes a scheduled job compares three records: the intent, the ledger and the
        chain. Recently recorded receipts are re-read from the network and must still be a
        successful, canonical USDC transfer of the recorded amount to the intent&apos;s address. It
        also raises liveness alerts for payments stuck confirming, a scanner that has stopped, held
        payments nobody has reviewed, and a network whose head is stale. Findings become alerts for
        operations. The job never edits an intent, reverses a journal or changes a merchant balance.
      </P>

      <H2 id="api">API</H2>
      <EndpointTable
        rows={[
          { method: "GET", path: "/api/merchant/payments", desc: "Signed-in merchant: links, payment intents and ready networks; ?id=<uuid> returns one payment with events and receipts" },
          { method: "POST", path: "/api/merchant/payments", desc: "Create a link, invoice or terminal request. Idempotent on requestId" },
          { method: "PATCH", path: "/api/merchant/payments", desc: "Activate or deactivate a link" },
          { method: "GET", path: "/api/merchant/payments/receipt", desc: "PDF receipt for a credited payment" },
          { method: "GET / POST / DELETE", path: "/api/merchant/refunds", desc: "List, request or cancel refunds" },
          { method: "GET / PUT / POST / DELETE", path: "/api/merchant/webhook", desc: "Webhook endpoint; POST sends a test event or re-queues one failed event" },
          { method: "GET", path: "/api/checkout/merchant/{slug}", desc: "Public: link details; ?intent=<uuid> returns checkout status and runs verification" },
          { method: "POST", path: "/api/checkout/merchant/{slug}", desc: "Public: reserve a checkout on one network: { requestId, chain }" },
          { method: "GET", path: "/api/checkout/merchant/{slug}/receipt", desc: "Public: receipt for a credited checkout" },
          { method: "GET / POST", path: "/api/merchant/operations", desc: "Operators only: held payments, alerts, pricing tiers, address registration, refund approval" },
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
        Merchant routes use the signed-in session; the merchant is always the authenticated account
        and no merchant ID is accepted from the client. The public checkout routes are rate limited
        per IP.
      </P>

      <H3 id="errors">Responses to handle</H3>
      <UL>
        <LI><Code>409</Code> on reserve — the link is closed, or a single-use checkout is already in progress.</LI>
        <LI><Code>503</Code> on reserve — the network is not ready (no destination, or the node could not be verified). No payment was requested.</LI>
        <LI><Code>503</Code> on merchant routes — payment storage is not configured or a migration is not applied.</LI>
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
        <LI><Code>/dashboard/operations</Code> — the operator console.</LI>
        <LI><Code>/p/&lt;slug&gt;</Code> — the public hosted checkout for one link.</LI>
      </UL>

      <H2 id="setup">Setup</H2>
      <UL>
        <LI><b>Database</b> — Supabase configured, with migrations <Code>0040</Code> (payments), <Code>0041</Code> (webhooks), <Code>0042</Code> (pricing tiers, reconciliation), <Code>0043</Code> (Sui), <Code>0045</Code> (refunds), <Code>0046</Code> (liveness alerts) and <Code>0047</Code> (Arc testnet) applied in order.</LI>
        <LI><b>Collection addresses</b> — registered through the operator console. Registration requires proof of control: the address itself signs a message naming the merchant, network, address and custody reference. FurlPay never generates, derives or stores keys for collection addresses. Each address is used for exactly one checkout, and there is no fallback to a shared address.</LI>
        <LI><b>Node endpoints</b> — <Code>BASE_RPC_URL</Code>, <Code>ARBITRUM_RPC_URL</Code>, <Code>ETHEREUM_RPC_URL</Code>, <Code>POLYGON_RPC_URL</Code>, <Code>SOLANA_RPC_URL</Code>, <Code>ARC_RPC_URL</Code> and <Code>SUI_GRAPHQL_URL</Code>, with optional <Code>_SECONDARY</Code> endpoints for failover. Unset values fall back to public endpoints, which are rate limited.</LI>
        <LI><b>Scheduled jobs</b> — <Code>/api/cron/merchant-payments</Code> every two minutes and <Code>/api/cron/merchant-reconcile</Code> every ten, both listed in <Code>vercel.json</Code>. Sub-daily schedules depend on the hosting plan.</LI>
        <LI><b>Webhook secrets</b> — <Code>FURLPAY_PARTNER_WEBHOOK_KEY</Code> seals merchant signing secrets at rest.</LI>
        <LI><b>Check</b> — <Code>npm run merchant:check-env</Code> reports what is missing. <Code>npm run merchant:seed-destinations</Code> registers pilot addresses on a local or staging database only; it refuses the production project.</LI>
      </UL>

      <Callout type="info" title="What this is not">
        Collected funds arrive at addresses a custody provider controls and are recorded in a USDC
        subledger. Paying those balances out to a merchant&apos;s bank account is not offered:
        FurlPay has no contracted banking or off-ramp partner.
      </Callout>

      <DocPager pathname="/docs/payments/merchant-payments" />
    </article>
  );
}
