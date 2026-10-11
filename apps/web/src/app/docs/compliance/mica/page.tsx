import { DocTitle, Lead, H2, P, Code, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/compliance/mica");

export default function MicaPage() {
  return (
    <article>
      <DocTitle eyebrow="Legal &amp; Compliance">Regulatory and service status</DocTitle>
      <Lead>
        This page summarizes documentation and integration boundaries. It does not claim that FurlPay
        holds a financial-services licence, is an authorized crypto-asset service provider, or can
        provide regulated services in a particular jurisdiction.
      </Lead>

      <Callout type="warning" title="No licensing or availability representation">
        A roadmap, compliance code or provider integration does not establish regulatory authorization.
        Confirm FurlPay&apos;s status and the availability of a specific service directly before relying
        on it. This page is not legal advice.
      </Callout>

      <H2 id="eu">EU — MiCA</H2>
      <P>
        FurlPay does not represent that it is MiCA-authorized, has passporting rights, or provides a
        MiCA-regulated service. Check the applicable regulator register and obtain jurisdiction-specific
        legal advice before offering a product to EU customers.
      </P>

      <H2 id="us">US — GENIUS Act</H2>
      <P>
        FurlPay does not claim to be a stablecoin issuer or to provide a regulated US payment service
        under a federal or state authorization. Asset and service availability must be confirmed for the
        specific deployment and user.
      </P>

      <H2 id="uk">UK — FCA</H2>
      <P>
        This documentation does not assert FCA registration, authorization or approval of FurlPay or its
        products. Do not interpret access to the website or an API as permission to use a regulated
        service in the UK.
      </P>

      <H2 id="kyc">Identity checks</H2>
      <P>
        Provider-backed identity checks are available only where configured for the account and region.
        The Persona webhook guide documents an integration surface; it does not promise that onboarding
        is enabled for every user. FurlPay does not document a live Sumsub service here.
      </P>

      <H2 id="travel-rule">Travel Rule data</H2>
      <P>
        FurlPay does not claim that qualifying transfers are automatically exchanged through the
        <Code>TRUST</Code> network or another Travel Rule provider. Whether a transfer can be made and
        what information is required depend on the service, counterparties and jurisdiction.
      </P>

      <Callout title="Before integrating">
        Confirm the service is shown as available in the{" "}
        <a href="/docs" className="text-neon hover:underline">service overview</a>, check the current
        <Code>/api/rails</Code> response for payment services, and get legal advice for your own
        obligations. If status cannot be verified, treat the service as unavailable.
      </Callout>

      <DocPager pathname="/docs/compliance/mica" />
    </article>
  );
}
