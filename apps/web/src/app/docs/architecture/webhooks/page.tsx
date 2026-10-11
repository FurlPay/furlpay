import { DocTitle, Lead, H2, P, UL, LI, Code, Callout, EndpointTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/architecture/webhooks");

export default function WebhooksPage() {
  return (
    <article>
      <DocTitle eyebrow="Architecture">Webhook events</DocTitle>
      <Lead>
        FurlPay receives provider webhooks and can deliver merchant payment events to a configured
        HTTPS endpoint. The signature header and freshness rules depend on which direction and
        provider you are integrating.
      </Lead>

      <H2 id="merchant-events">Events FurlPay sends to merchants</H2>
      <P>
        A merchant can register an HTTPS endpoint through the authenticated{" "}
        <Code>/api/merchant/webhook</Code> API. The current outbox event types are{" "}
        <Code>payment.succeeded</Code> and <Code>invoice.paid</Code>.
      </P>
      <EndpointTable
        rows={[
          { method: "GET", path: "/api/merchant/webhook", desc: "Read the signed-in merchant's endpoint; secret is never returned" },
          { method: "PUT", path: "/api/merchant/webhook", desc: "Set an HTTPS endpoint and rotate its secret; plaintext secret is returned once" },
          { method: "DELETE", path: "/api/merchant/webhook", desc: "Remove the signed-in merchant's endpoint" },
        ]}
      />
      <P>
        Delivery is at-least-once. Deduplicate on <Code>X-FurlPay-Event-Id</Code>; retries use
        the same event ID. The endpoint must return a 2xx response. Delivery retries are bounded,
        and the payment ledger remains the source of truth.
      </P>
      <UL>
        <LI><Code>X-FurlPay-Event-Id</Code> identifies the outbox event.</LI>
        <LI><Code>X-FurlPay-Attempt</Code> is the delivery attempt number.</LI>
        <LI><Code>X-FurlPay-Signature</Code> uses <Code>t=&lt;unix&gt;,v1=&lt;hex&gt;</Code>.</LI>
      </UL>
      <P>
        The signature is HMAC-SHA256 over <Code>timestamp + &quot;.&quot; + rawBody</Code> using the
        endpoint secret. Reject timestamps outside the five-minute tolerance, compare signatures
        in constant time, and parse the JSON only after verification. The Node SDK verification
        helper accepts the signature value; pass it the value of the{" "}
        <Code>X-FurlPay-Signature</Code> header.
      </P>
      <Callout type="warning" title="Merchant webhook delivery can be unavailable">
        Durable webhook storage requires the merchant payment database migrations and
        <Code>FURLPAY_PARTNER_WEBHOOK_KEY</Code>. If endpoint configuration returns{" "}
        <Code>503</Code>, do not assume events are being delivered.
      </Callout>

      <H2 id="inbound">Provider webhooks FurlPay receives</H2>
      <EndpointTable
        rows={[
          { method: "POST", path: "/api/webhooks/stripe", desc: "Stripe events; Stripe SDK signature verification over the raw body" },
          { method: "POST", path: "/api/webhooks/sumsub", desc: "Sumsub verification outcomes; HMAC digest headers" },
          { method: "POST", path: "/api/webhooks/persona", desc: "Persona inquiry outcomes; timestamped signature validation and user-binding check" },
          { method: "POST", path: "/api/webhooks/deposit-detect", desc: "Configured chain-provider deposit notifications; provider HMAC validation" },
          { method: "POST", path: "/api/webhooks/complyadvantage", desc: "Configured screening-provider events" },
          { method: "POST", path: "/api/webhooks/card-auth", desc: "Card-auth events; signed, timestamped payload verification" },
        ]}
      />
      <P>
        Configure each provider&apos;s credentials and endpoint secret separately. Handlers verify
        provider-specific headers before trusting payloads, and some may fail closed with{" "}
        <Code>503</Code> when production configuration is absent. Do not reuse a secret or
        verification snippet across providers without confirming their exact scheme.
      </P>

      <H2 id="local">Local development</H2>
      <P>
        The <Code>@furlpay/cli</Code> package includes webhook-forwarding commands for development.
        Use test events and a test endpoint secret locally. A forwarded or simulated event is not
        evidence of a production payment.
      </P>

      <Callout type="danger" title="Never credit a balance from an unverified event">
        Treat webhook input as untrusted until signature, freshness, event identity and
        idempotency checks pass. Reconcile against the provider or settlement record before
        crediting funds.
      </Callout>

      <DocPager pathname="/docs/architecture/webhooks" />
    </article>
  );
}
