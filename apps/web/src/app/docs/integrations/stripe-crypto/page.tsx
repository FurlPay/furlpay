import { DocTitle, Lead, H2, P, UL, LI, Code, Callout, EndpointTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/integrations/stripe-crypto");

export default function StripeCryptoPage() {
  return (
    <article>
      <DocTitle eyebrow="Integrations">Stripe payment integration</DocTitle>
      <Lead>
        FurlPay contains an optional Stripe PaymentIntent and webhook integration. A configured
        Stripe account, enabled payment method and deployment credentials are required. This page
        does not mean FurlPay offers a generally available fiat or crypto on-ramp.
      </Lead>

      <Callout type="warning" title="Provider configuration is required">
        Do not assume a Stripe crypto payment method is enabled for your account or deployment.
        Confirm product eligibility and settlement behavior with Stripe, and verify FurlPay&apos;s
        current service availability before presenting checkout to customers.
      </Callout>

      <H2 id="intent">PaymentIntent route</H2>
      <EndpointTable
        rows={[
          { method: "POST", path: "/api/payments/stripe/intent", desc: "Creates a USD Stripe PaymentIntent from a positive amount in cents; maximum $50,000" },
          { method: "POST", path: "/api/webhooks/stripe", desc: "Verifies Stripe's signature over the raw event body and processes supported events" },
        ]}
      />
      <P>
        The intent route validates <Code>amountInCents</Code> and accepts USD only. It returns a
        provider error when the Stripe integration cannot create the intent. Keep the returned
        client secret server-side until the approved Stripe client flow needs it; never log or
        expose a secret outside that flow.
      </P>

      <H2 id="webhook">Webhook requirements</H2>
      <UL>
        <LI>Register the exact endpoint and event types with the Stripe account used by the deployment.</LI>
        <LI>Set the corresponding webhook secret in the server environment; production fails closed if it is missing.</LI>
        <LI>Verify the <Code>stripe-signature</Code> against the raw body before processing.</LI>
        <LI>Handle duplicate delivery idempotently and reconcile provider status before crediting an account.</LI>
      </UL>

      <H2 id="availability">Service availability</H2>
      <P>
        Stripe&apos;s product approval, payment-method availability, regional coverage, fees and
        settlement rules are determined by Stripe and the configured account. FurlPay does not
        guarantee that this integration is enabled in production. Check the{" "}
        <a href="/docs" className="text-neon hover:underline">service availability overview</a>{" "}
        and the applicable provider dashboard before launch.
      </P>

      <DocPager pathname="/docs/integrations/stripe-crypto" />
    </article>
  );
}
