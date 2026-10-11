import { DocTitle, Lead, H2, H3, P, UL, LI, Code, Callout, EndpointTable, ParameterTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/compliance/screening");

export default function ScreeningPage() {
  return (
    <article>
      <DocTitle eyebrow="Legal & Compliance">Screening, monitoring and case management</DocTitle>
      <Lead>
        This page describes the compliance controls implemented in the platform: address and name
        screening, transaction monitoring rules, the case queue and report exports. It describes
        software behaviour. It is not a statement that FurlPay holds any licence or that a given
        transfer is lawful.
      </Lead>

      <H2 id="address-screening">Wallet address screening</H2>
      <P>Money routes call one address screen. It layers up to three checks, and the strictest result wins:</P>
      <ParameterTable
        params={[
          { name: "Sanctions list", type: "always", required: true, desc: "A bundled OFAC SDN snapshot, checked locally with no external call. A match blocks." },
          { name: "Circle Compliance Engine", type: "when configured", required: false, desc: "A second, independent opinion on Ethereum, Polygon, Arbitrum, Avalanche, OP Mainnet and Solana. Circle does not screen Base, so Base addresses get the sanctions check only." },
          { name: "USDC issuer blocklist", type: "USDC routes", required: false, desc: "Reads the issuer's on-chain blocklist for the address on the exact network. Used by merchant payments, payroll, batch payouts and Circle wallet transfers." },
        ]}
      />
      <UL>
        <LI><b>Fail closed.</b> Once Circle is configured, a network error, a non-2xx response or an unexpected response shape is a block. An unreachable node during the issuer check is reported as <Code>screening_unavailable</Code> and blocks.</LI>
        <LI><b>Distinct reasons.</b> An issuer freeze is recorded as <Code>usdc_issuer_blocked</Code>, separate from a sanctions match, so the two are never confused in an audit.</LI>
        <LI><b>Review means stop.</b> Where a route has no review queue, a <Code>review</Code> result refuses the action rather than letting it through.</LI>
      </UL>
      <Callout type="info" title="Sanctions data freshness">
        The bundled sanctions list is a snapshot shipped with the code. It is as current as the last
        release that refreshed it. A deployment that needs continuously updated lists should
        configure an external screening provider.
      </Callout>

      <H2 id="name-screening">Name screening for businesses</H2>
      <P>
        Business onboarding screens the legal name, trading name, owners and the authorised
        representative. The provider is chosen by <Code>COMPLIANCE_SCREENING_PROVIDER</Code>:
      </P>
      <UL>
        <LI><Code>furlpay</Code> (default) — the bundled sanctions list; no external call. It does not cover politically exposed persons or adverse media.</LI>
        <LI><Code>complyadvantage</Code> — external sanctions, PEP and adverse-media screening; needs <Code>COMPLYADVANTAGE_API_KEY</Code>.</LI>
      </UL>
      <P>
        Each onboarding case keeps an append-only log of up to 25 screening runs and decisions. A
        run that never reached the provider is logged as <Code>UNAVAILABLE</Code>, never as{" "}
        <Code>CLEAR</Code>. Default re-screening intervals are 90 days for high and very high
        country risk, 180 for medium and 365 for low. These are policy defaults for a compliance
        team to approve, not regulatory requirements.
      </P>

      <H2 id="monitoring">Transaction monitoring</H2>
      <P>
        Monitoring is a deterministic rule engine over an account&apos;s own ledger rows. It only
        reads transactions and raises alerts. It never changes a balance or holds a payment. Rules
        are versioned constants; changing a threshold is a reviewed code change.
      </P>
      <ParameterTable
        params={[
          { name: "high_value", type: "enabled", required: true, desc: "A single transaction at or above the configured USD threshold." },
          { name: "velocity", type: "enabled", required: true, desc: "Too many transactions, or too much value, in a rolling 24-hour window." },
          { name: "structuring", type: "enabled", required: true, desc: "Several transactions just under the high-value threshold within 72 hours." },
          { name: "failed_anomaly", type: "enabled", required: true, desc: "Five or more declined transactions within one hour." },
          { name: "new_wallet_exposure", type: "disabled", required: false, desc: "Declared, not running." },
          { name: "geographic_risk", type: "disabled", required: false, desc: "Declared, not running: ledger rows do not record a counterparty country." },
          { name: "counterparty_risk", type: "disabled", required: false, desc: "Declared, not running: ledger rows do not record a counterparty screening result." },
        ]}
      />
      <P>
        Disabled rules are listed with the missing data named, so the console never implies that
        something is monitored when it is not. Every alert has a stable key, so evaluating the same
        history twice opens each case once.
      </P>

      <H2 id="cases">Case management</H2>
      <P>
        Reviews, screening hits and monitoring alerts become cases. Each case carries a unique
        source key naming one underlying event, so duplicates cannot be created. Cases are closed,
        never deleted.
      </P>
      <UL>
        <LI><b>Types:</b> KYC review, KYB review, sanctions match, PEP match, adverse media, fraud, monitoring alert, travel rule, wallet screening, settlement hold.</LI>
        <LI><b>Statuses:</b> open, triaged, assigned, investigating, escalated, decision pending, resolved, closed.</LI>
        <LI><b>Target response times by severity:</b> critical 24 hours, high 72 hours, medium 7 days, low 14 days.</LI>
        <LI><b>Resolutions:</b> no action, false positive, confirmed, account restricted, reported, source resolved.</LI>
      </UL>
      <P>
        Cases are visible only to compliance officers. The subject of a case never sees it, and an
        officer can never act on a case about themselves. Today cases are derived automatically from
        business onboarding reviews and sanctions screening results.
      </P>

      <H3 id="reports">Report exports</H3>
      <P>
        Officers can export CSV reports: cases, case audit trail, monitoring alerts, sanctions
        screening, KYB reviews and investigator activity. Columns never include dates of birth,
        emails, phone numbers, ID numbers or document contents, and cells are escaped against
        spreadsheet formula injection.
      </P>

      <H2 id="travel-rule">Travel rule</H2>
      <P>Two separate pieces exist, and neither one authorises a payment:</P>
      <UL>
        <LI><Code>POST /api/compliance/travel-rule</Code> is a compute endpoint for signed-in callers. Given an amount and two counterparties, it returns the payload a transfer of that size would need. It sends nothing to any provider.</LI>
        <LI>A Notabene Transact v2 transport adapter can submit a complete transfer envelope when the deployment has Notabene OAuth credentials, an API audience, an entity DID and an approved regional endpoint. It identifies parties by DID and deliberately does not accept or log raw personal data. No payment route calls it automatically.</LI>
      </UL>

      <H2 id="api">API</H2>
      <EndpointTable
        rows={[
          { method: "POST", path: "/api/compliance/screen", desc: "Signed-in: screen a name, and optionally up to 10 wallet addresses" },
          { method: "POST", path: "/api/compliance/travel-rule", desc: "Signed-in: compute the travel-rule payload for a transfer" },
          { method: "GET", path: "/api/compliance/jurisdiction", desc: "Jurisdiction rules for the caller" },
          { method: "GET / POST", path: "/api/compliance/tier", desc: "The account's verification tier and limits" },
          { method: "GET", path: "/api/compliance/overview", desc: "Officers only: capability registry and health, from durable records" },
          { method: "GET / POST", path: "/api/compliance/cases", desc: "Officers only: case queue; open a case" },
          { method: "GET / POST", path: "/api/compliance/cases/{id}", desc: "Officers only: one case; assign, escalate, decide" },
          { method: "GET / POST", path: "/api/compliance/monitoring", desc: "Officers only: rules and alert evaluation" },
          { method: "GET", path: "/api/compliance/reports", desc: "Officers only: CSV exports" },
          { method: "GET / POST", path: "/api/compliance/role-grants", desc: "Request, approve or revoke the compliance_officer role" },
        ]}
      />

      <H2 id="setup">Setup</H2>
      <UL>
        <LI><Code>CIRCLE_COMPLIANCE_API_KEY</Code> — enables the Circle Compliance Engine layer. Unset means the sanctions list is the only address layer.</LI>
        <LI><Code>COMPLIANCE_SCREENING_PROVIDER</Code> and, for ComplyAdvantage, <Code>COMPLYADVANTAGE_API_KEY</Code> and <Code>COMPLYADVANTAGE_WEBHOOK_SECRET</Code>.</LI>
        <LI><Code>COMPLIANCE_IDENTITY_PROVIDER</Code> with the Persona or Sumsub credentials. See <a href="/docs/integrations/persona-kyc" className="text-neon hover:underline">Persona KYC</a>.</LI>
        <LI>Node endpoints for the issuer blocklist check on each network.</LI>
        <LI>Migration <Code>0039_compliance_cases</Code> for durable cases.</LI>
        <LI><Code>NOTABENE_CLIENT_ID</Code>, <Code>NOTABENE_CLIENT_SECRET</Code>, <Code>NOTABENE_ENTITY_DID</Code>, <Code>NOTABENE_API_URL</Code>, <Code>NOTABENE_AUTH_URL</Code> and <Code>NOTABENE_API_AUDIENCE</Code> for the travel-rule transport.</LI>
      </UL>

      <Callout type="warning" title="Software controls are not a compliance programme">
        These controls support a compliance team; they do not replace one. Whether a business may
        offer a service in a jurisdiction depends on licences and legal advice, which are covered in{" "}
        <a href="/docs/compliance/mica" className="text-neon hover:underline">Regulatory status</a>.
      </Callout>

      <DocPager pathname="/docs/compliance/screening" />
    </article>
  );
}
