import { DocTitle, Lead, H2, P, UL, LI, Code, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/x402-basics");

export default function X402BasicsHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">x402 monetization basics</DocTitle>
      <Lead>
        x402 is a protocol for requesting payment per HTTP request. FurlPay&apos;s endpoint returned
        <Code>503 controls_unavailable</Code> with reason <Code>plan_limit</Code> on 11 October 2026.
        Production settlement is also in development.
      </Lead>

      <Callout type="warning" title="FurlPay x402 is currently unavailable">
        The endpoint is not currently issuing challenges, and the default facilitator is not enabled
        for production settlement. You can develop an integration or connect a facilitator you
        operate or have separately contracted. Check <Code>/api/rails</Code> and the x402 endpoint
        before offering a paid resource; if either reports an error, treat the rail as unavailable.
      </Callout>

      <H2 id="idea">How the protocol works</H2>
      <P>
        An unpaid request can receive <Code>402 Payment Required</Code> with payment requirements.
        The caller signs a compatible payment authorization and retries with it attached. A
        configured facilitator verifies and settles the payment before the endpoint releases the
        paid response. A challenge by itself does not authorize access to paid data.
      </P>

      <H2 id="versions">Protocol versions</H2>
      <P>
        x402 clients and services may use different header and payload formats. FurlPay&apos;s
        integration guide documents the supported request formats and its separate production
        settlement status. Check the protocol guide before choosing a client or facilitator.
      </P>

      <H2 id="gateway">Self-hosted gateway package</H2>
      <P>
        The open-source <Code>@furlpay/gateway</Code> package can protect an API you operate.
        Configure the resource price, destination wallet and quote secret, then choose an
        available facilitator. The package can also be used with a facilitator you operate or
        contract separately; FurlPay&apos;s default facilitator is not currently enabled for
        production settlement.
      </P>
      <P>
        See the current{" "}
        <a href="https://www.npmjs.com/package/@furlpay/gateway" className="text-neon hover:underline">
          package documentation on npm
        </a>{" "}
        for installation and framework-specific examples.
      </P>

      <H2 id="protections">What a production integration must verify</H2>
      <UL>
        <LI>Bind the payment requirements to the exact resource, method, amount, asset and network.</LI>
        <LI>Reject expired authorizations, replayed nonces, underpayment and a wrong recipient.</LI>
        <LI>Release paid content only after the configured facilitator confirms settlement.</LI>
        <LI>Use shared replay protection when deploying multiple gateway instances.</LI>
      </UL>

      <Callout type="info" title="Confirm the settlement recipient">
        After the selected facilitator confirms settlement, funds go to the wallet configured as
        <Code>payTo</Code>. Verify the recipient, network, asset and settlement transaction before
        releasing the protected resource.
      </Callout>

      <P>
        For FurlPay&apos;s request and settlement status, read{" "}
        <a href="/docs/payments/agentic-x402" className="text-neon hover:underline">Agentic Payments (x402)</a>{" "}
        and the <a href="/docs" className="text-neon hover:underline">service availability overview</a>.
      </P>

      <DocPager pathname="/docs/help/x402-basics" />
    </article>
  );
}
