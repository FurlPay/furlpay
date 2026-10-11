import { DocTitle, Lead, H2, H3, P, UL, LI, Code, Callout, EndpointTable, ParameterTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/settlement/workspace");

export default function SettlementWorkspacePage() {
  return (
    <article>
      <DocTitle eyebrow="Business">Settlement workspace and business onboarding</DocTitle>
      <Lead>
        The settlement workspace at <Code>/settlement</Code> is the business console: payments,
        payouts, treasury, compliance, reconciliation and developer settings in one place. A
        business reaches it through a seven-step onboarding that the server controls end to end.
      </Lead>

      <Callout type="warning" title="Drafts are not instructions to move money">
        Records saved in the workspace (beneficiaries, payouts, schedules, invoices, payment links,
        split rules, checkout configurations) are stored as drafts. The workspace endpoint cannot
        activate an automation, produce an approval, publish a payable link or move a balance. Real
        collection goes through{" "}
        <a href="/docs/payments/merchant-payments" className="text-neon hover:underline">merchant payments</a>;
        real payroll goes through{" "}
        <a href="/docs/payments/payroll" className="text-neon hover:underline">payroll</a>.
      </Callout>

      <H2 id="sections">Workspace sections</H2>
      <ParameterTable
        params={[
          { name: "Overview", type: "/settlement", required: true, desc: "Balances, in-transit totals and activity for 24h, 7d, 30d and 90d, derived only from the account's own ledger." },
          { name: "Payments", type: "/settlement/payments", required: true, desc: "Transactions, receive, links, invoices, checkout." },
          { name: "Payouts", type: "/settlement/payouts", required: true, desc: "Send, batch, schedules, approvals, beneficiaries." },
          { name: "Treasury", type: "/settlement/treasury", required: true, desc: "Balances, convert, rules; virtual accounts sit under this tab." },
          { name: "Compliance", type: "/settlement/compliance", required: true, desc: "The business's own verification and screening state." },
          { name: "Reconcile", type: "/settlement/reconcile", required: true, desc: "Reconciliation and reports." },
          { name: "Developers", type: "/settlement/developers", required: true, desc: "API keys and webhook settings." },
        ]}
      />
      <P>
        Every URL under <Code>/settlement</Code> is validated on the server: it is a real page, a
        redirect to one, or a 404. Figures the ledger does not record, such as finality, fees or
        transaction hashes, are shown as a dash rather than estimated.
      </P>

      <H3 id="assets">Assets and networks in drafts</H3>
      <P>
        Drafts accept Arbitrum, Base, Ethereum, Solana and Polygon, and the assets USDC, EURC, USDT,
        USD, EUR and GBP. Avalanche, SOL and ETH are shown as explicitly unavailable: FurlPay does
        not detect settlement deposits on Avalanche, and settlement holds stablecoins and fiat
        rather than volatile native tokens. Listing an asset in a draft form does not mean FurlPay
        custodies or converts it.
      </P>

      <H2 id="onboarding">Business onboarding</H2>
      <P>
        Onboarding lives at <Code>/settlement/onboarding/&lt;step&gt;</Code>. The client edits one
        step at a time. The server alone decides which steps are complete, the screening result, the
        document review state and activation. Steps cannot be skipped: each one requires the earlier
        steps to be complete.
      </P>
      <ParameterTable
        params={[
          { name: "1. Business information", type: "business-information", required: true, desc: "Legal name, type (company, individual, marketplace, non-profit), industry, country, size." },
          { name: "2. Verify identity", type: "identity", required: true, desc: "Authorised representative and document uploads." },
          { name: "3. Business details", type: "business-details", required: true, desc: "Ownership and control." },
          { name: "4. Compliance and risk", type: "compliance", required: true, desc: "Sanctions screening of the business, its owners and the representative." },
          { name: "5. Set up treasury", type: "treasury", required: true, desc: "Wallets and account preferences." },
          { name: "6. Configure settlement", type: "settlement", required: true, desc: "Split rules; whole percentages that must total 100, at most 10 rules." },
          { name: "7. Review and activate", type: "review", required: true, desc: "Readiness is re-derived from stored state; client state is never trusted." },
        ]}
      />

      <H3 id="documents">Documents</H3>
      <P>
        Required: certificate of incorporation, articles of association, proof of business address
        and the front of a government ID. Optional: business licence and ID back. Files must be PDF,
        PNG or JPEG, at most 10 MB, and are stored in a private bucket with no public URLs.
      </P>

      <H3 id="screening">Screening</H3>
      <P>
        Screening covers the legal name, trading name, each owner and the representative. A result
        is reused for identical inputs for 24 hours. A provider error or a timeout (10 seconds) is
        recorded as <Code>failed</Code> and shown as &quot;Screening unavailable&quot;; it is never
        recorded as clear. A potential match sends the case to compliance review. Details are in{" "}
        <a href="/docs/compliance/screening" className="text-neon hover:underline">Screening and cases</a>.
      </P>

      <H3 id="review">Compliance review</H3>
      <P>
        Review actions are restricted to accounts holding the <Code>compliance_officer</Code> role.
        A reviewer can never decide their own case. Each decision records who, when, what and why,
        and is written to the audit log. Editing business, identity or ownership facts after
        approval reopens the review, because the approval covered the old facts.
      </P>

      <H3 id="activation">Activation</H3>
      <P>
        Activation succeeds only when no blocker remains. The response lists the exact blockers
        otherwise, for example: required documents missing, documents pending approval, sanctions
        screening not run or expired, screening awaiting review, verification provider not
        configured, document storage unavailable, treasury or settlement not configured.
      </P>
      <Callout type="info" title="What activation does not do">
        Activation records that a business completed onboarding in the workspace. It does not grant
        a licence, open a bank account, or turn on a payment rail. Each rail keeps its own gate.
      </Callout>

      <H2 id="api">API</H2>
      <EndpointTable
        rows={[
          { method: "GET", path: "/api/settlement/workspace", desc: "Snapshot: balances, overview metrics, up to 500 transactions, saved drafts, storage state" },
          { method: "POST", path: "/api/settlement/workspace", desc: "Save one draft record { id, data }; destination addresses are validated for their network" },
          { method: "PATCH", path: "/api/settlement/workspace", desc: "Archive a draft record" },
          { method: "GET", path: "/api/settlement/transactions", desc: "Search and filter the account's ledger transactions" },
          { method: "GET", path: "/api/settlement/onboarding", desc: "Onboarding state, step status and readiness" },
          { method: "PUT", path: "/api/settlement/onboarding", desc: "Save or complete one step; 422 with field errors, 409 with blockers" },
          { method: "POST", path: "/api/settlement/onboarding", desc: "Actions: run screening, complete the compliance step, start identity verification, activate" },
          { method: "POST / DELETE", path: "/api/settlement/onboarding/documents", desc: "Upload or remove a document" },
          { method: "GET / POST", path: "/api/settlement/onboarding/review", desc: "Compliance officers only: review queue and decisions" },
        ]}
      />
      <P>
        All routes require a signed-in session. When storage is not configured, write routes answer{" "}
        <Code>503</Code> and state that nothing was saved; the workspace snapshot still loads and
        reports <Code>storage: &quot;unavailable&quot;</Code>.
      </P>

      <H2 id="setup">Setup</H2>
      <UL>
        <LI>Supabase configured, with migrations <Code>0037_settlement_workspace</Code>, <Code>0038_settlement_onboarding</Code> and <Code>0039_compliance_cases</Code> applied. Migration 0038 also creates the private document bucket.</LI>
        <LI>An identity provider: <Code>COMPLIANCE_IDENTITY_PROVIDER</Code> set to <Code>persona</Code> (default, needs <Code>PERSONA_API_KEY</Code>) or <Code>sumsub</Code> (needs <Code>SUMSUB_APP_TOKEN</Code> and <Code>SUMSUB_SECRET_KEY</Code>). Without one, identity verification reports unavailable and activation stays blocked.</LI>
        <LI>A screening provider: <Code>COMPLIANCE_SCREENING_PROVIDER</Code>, default <Code>furlpay</Code> (the bundled sanctions list) or <Code>complyadvantage</Code> with its API key.</LI>
        <LI>At least one account granted the <Code>compliance_officer</Code> role through the role-grant process, or no case can be reviewed.</LI>
      </UL>

      <DocPager pathname="/docs/settlement/workspace" />
    </article>
  );
}
