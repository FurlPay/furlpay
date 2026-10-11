import { DocTitle, Lead, H2, P, UL, LI, Code, Callout, EndpointTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/integrations/persona-kyc");

export default function PersonaKycPage() {
  return (
    <article>
      <DocTitle eyebrow="Integrations">Persona verification integration</DocTitle>
      <Lead>
        FurlPay contains a Persona webhook integration for processing verification outcomes.
        Provider credentials and an approved Persona configuration are required; this technical
        integration page is not an offer of identity verification in every account or region.
      </Lead>

      <Callout type="warning" title="Availability is account and provider dependent">
        Users should start verification only from a flow shown inside their signed-in FurlPay
        account. Do not create a separate Persona inquiry or send documents based on a code sample
        on this page.
      </Callout>

      <H2 id="handler">Webhook handling</H2>
      <EndpointTable
        rows={[
          { method: "POST", path: "/api/webhooks/persona", desc: "Verifies Persona's signature over the raw request body and processes a bound inquiry outcome" },
        ]}
      />
      <P>
        The handler verifies the <Code>persona-signature</Code> header before parsing JSON. It
        requires <Code>PERSONA_WEBHOOK_SECRET</Code>, rejects an invalid or missing signature,
        de-duplicates deliveries and checks the inquiry&apos;s server-side user binding before
        changing a verification status. Missing configuration fails closed.
      </P>

      <H2 id="deployment">Deployment requirements</H2>
      <UL>
        <LI>Configure the Persona account and server-side credentials through the deployment's approved secret-management process.</LI>
        <LI>Register the exact production webhook URL with Persona and use the matching webhook secret.</LI>
        <LI>Exercise inquiry binding, duplicate delivery, failure and out-of-order events in a non-production environment first.</LI>
        <LI>Do not treat a webhook acknowledgement as proof that a user passed verification; inspect the account's recorded status.</LI>
      </UL>

      <H2 id="user-guidance">User-facing guidance</H2>
      <P>
        The supported verification provider, required documents and current status should be
        displayed by the authenticated product. See the{" "}
        <a href="/docs/help/kyc-verification" className="text-neon hover:underline">identity verification help page</a>{" "}
        for safe user guidance.
      </P>

      <DocPager pathname="/docs/integrations/persona-kyc" />
    </article>
  );
}
