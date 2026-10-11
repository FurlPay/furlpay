import { DocTitle, Lead, H2, H3, P, UL, LI, Code, Callout, EndpointTable, ParameterTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/integrations/ramps");

export default function RampsPage() {
  return (
    <article>
      <DocTitle eyebrow="Integrations">Buying and selling crypto: ramp providers</DocTitle>
      <Lead>
        Converting between bank money and crypto is done by third-party providers, not by FurlPay.
        This page explains which provider adapters exist, what state each is in, and how the order
        record, partner keys and callbacks work.
      </Lead>

      <Callout type="warning" title="FurlPay does not operate an on-ramp or off-ramp">
        No provider contract has reached the state where a live transaction has been observed end to
        end, so the provider router stays off. Where a provider&apos;s own hosted checkout is
        configured, the user buys or sells on that provider&apos;s page, under that provider&apos;s
        terms and identity checks. FurlPay does not hold the funds and does not learn the outcome
        from Coinbase.
      </Callout>

      <H2 id="providers">Providers</H2>
      <P>
        In code the providers have internal names so that routes and logs are not tied to a vendor.
        Users are always shown the real company that processes their payment.
      </P>
      <ParameterTable
        params={[
          { name: "Coinbase (FurlGateway)", type: "hosted checkout", required: false, desc: "Coinbase Developer Platform on-ramp and off-ramp. Opens a Coinbase-hosted page when the API key is set. Coinbase sends FurlPay no status updates. Contract status: in discussion." },
          { name: "Transak (FurlBridge)", type: "adapter", required: false, desc: "On-ramp and off-ramp adapter with a signed webhook. No contract yet; the webhook is not linked to completed FurlPay orders. Contract status: in discussion." },
          { name: "Echo Money (FurlPayout)", type: "not registered", required: false, desc: "Payout adapter code exists, but the provider's API and webhook scheme are unverified, so the adapter is never registered. No contract." },
        ]}
      />

      <H2 id="states">Three states a deployment can be in</H2>
      <UL>
        <LI><b>Router on</b> (<Code>ONRAMP_LIVE</Code> or <Code>OFFRAMP_LIVE</Code>) — the router would pick an adapter for the customer&apos;s country, currency and payment method. Both flags are marked unimplemented and cannot be turned on by an environment variable.</LI>
        <LI><b>Hosted checkout</b> — the Coinbase key is set, so a session opens Coinbase&apos;s own page.</LI>
        <LI><b>Nothing configured</b> — production returns <Code>503</Code>. A demo session exists in development only.</LI>
      </UL>

      <H2 id="capability">The capability matrix</H2>
      <P>
        Whether a provider may be used for a corridor is data, not an assumption. Each row records
        the direction, country, currency, assets and payment methods, plus a contract status:{" "}
        <Code>none</Code>, <Code>in_discussion</Code>, <Code>signed_pending_credentials</Code> or{" "}
        <Code>live</Code>. Only a row that is <Code>live</Code>, with its evidence link and
        credentials, can be selected for a real transaction. No row is live today, and no row exists
        for Indian bank rails because there is no signed Indian partner.
      </P>

      <H2 id="orders">Order records</H2>
      <P>
        Whenever a provider is involved, a ramp order is written before the provider is called, so a
        crash after the provider answers still leaves a record. The provider is given FurlPay&apos;s
        order ID as its reference. If the provider call fails, the order is marked failed and the
        API returns <Code>502</Code>.
      </P>
      <EndpointTable
        rows={[
          { method: "POST", path: "/api/onramp/quote", desc: "Purchase quote from Coinbase's quote API when configured; 503 in production otherwise" },
          { method: "POST", path: "/api/onramp/session", desc: "Open an on-ramp checkout; returns orderId when a provider is involved" },
          { method: "GET", path: "/api/onramp/session/{id}", desc: "Session status" },
          { method: "POST", path: "/api/offramp/session", desc: "Open a Coinbase-hosted sell checkout; 503 without credentials" },
          { method: "GET", path: "/api/ramp/orders", desc: "The caller's ramp orders" },
          { method: "GET", path: "/api/ramp/orders/{orderId}", desc: "One ramp order" },
          { method: "POST / GET", path: "/api/offramp/beneficiary", desc: "Bank account collection; refuses today (see below)" },
        ]}
      />

      <H3 id="beneficiaries">Bank accounts are not collected</H3>
      <P>
        Paying an unverified bank account is how a substituted beneficiary gets paid. FurlPay has no
        account-verification partner, so <Code>/api/offramp/beneficiary</Code> returns{" "}
        <Code>503 beneficiary_verification_unavailable</Code> and stores nothing. The
        server-initiated off-ramp that would pay a verified beneficiary is therefore unavailable.
      </P>

      <H2 id="partners">Partner integration</H2>
      <P>
        A business can embed the on-ramp with <Code>@furlpay/elements</Code> using a publishable
        key, instead of a user session. Whether ramps are enabled for a partner is an operations
        decision.
      </P>
      <EndpointTable
        rows={[
          { method: "GET", path: "/api/developer/ramp", desc: "Whether ramps are enabled for this account, and the configured callback" },
          { method: "PUT", path: "/api/developer/ramp", desc: "Set the callback URL; returns a new signing secret once" },
          { method: "DELETE", path: "/api/developer/ramp", desc: "Remove the callback" },
        ]}
      />
      <P>
        Callbacks are signed with <Code>X-FurlPay-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</Code>,
        an HMAC-SHA256 over <Code>t + &quot;.&quot; + body</Code>. Callback URLs must be HTTPS and
        resolve to a public address; this is checked when set and again at every delivery. Failed
        callbacks are retried up to five times, from one minute to six hours apart.
      </P>

      <H2 id="maintenance">Background maintenance</H2>
      <P>
        <Code>GET /api/cron/ramp-maintenance</Code> marks unpaid checkouts older than 30 minutes as
        abandoned, sends stuck deliveries and payouts to manual review, and retries due partner
        callbacks. It needs to run every few minutes and is not in the default cron list, so it must
        be scheduled by the deployment with the cron secret.
      </P>

      <H2 id="setup">Setup</H2>
      <UL>
        <LI><Code>FURLGATEWAY_API_KEY_ID</Code> and <Code>FURLGATEWAY_API_KEY_SECRET</Code> (or the older <Code>CDP_API_KEY_ID</Code> and <Code>CDP_API_KEY_SECRET</Code>) — Coinbase Developer Platform key for hosted checkout.</LI>
        <LI><Code>FURLBRIDGE_API_KEY</Code>, <Code>FURLBRIDGE_SECRET_KEY</Code>, <Code>FURLBRIDGE_ACCESS_TOKEN</Code>, <Code>FURLBRIDGE_API_URL</Code> — Transak. The webhook at <Code>/api/webhooks/furlbridge</Code> is verified as an HS256 token keyed with the access token.</LI>
        <LI><Code>FURLPAY_PARTNER_WEBHOOK_KEY</Code> — seals partner callback secrets. Unset means <Code>/api/developer/ramp</Code> returns 503 and no callbacks are sent.</LI>
        <LI><Code>FURLPAY_BENEFICIARY_ENCRYPTION_KEY</Code> — encryption key for stored bank details, for the day a verification partner exists.</LI>
      </UL>

      <DocPager pathname="/docs/integrations/ramps" />
    </article>
  );
}
