import { DocTitle, Lead, H2, H3, P, UL, LI, Code, Callout, EndpointTable, ParameterTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/payments/payroll");

export default function PayrollPage() {
  return (
    <article>
      <DocTitle eyebrow="Payments">Contractor payroll and payouts</DocTitle>
      <Lead>
        Payroll lets an employer keep a contractor roster, draft a pay run in USDC and authorise it
        from their own wallet. FurlPay prepares the typed data, checks every participant and reads
        the result back from the chain. FurlPay never holds the employer&apos;s funds or signs the
        transfer.
      </Lead>

      <Callout type="warning" title="Execution is not enabled by default">
        Rosters, drafts and the signing flow are implemented. Executing a run additionally needs an
        approved payment-router deployment recorded by operations for the chosen network; none is
        recorded in this repository. Until one exists, preparing a run returns a refusal and the
        draft stays saved. Tax documents and bank accounts need a contracted provider, which FurlPay
        does not currently have.
      </Callout>

      <H2 id="roster">Contractor roster</H2>
      <P>Each contractor record holds:</P>
      <UL>
        <LI>name, email and two-letter country code;</LI>
        <LI>payout network and wallet address (validated for that network);</LI>
        <LI>monthly amount in USDC (up to 1,000,000);</LI>
        <LI>tax form type: <Code>W9</Code>, <Code>W8BEN</Code> or <Code>W8BENE</Code>;</LI>
        <LI>tax status: <Code>pending</Code>, <Code>verified</Code>, <Code>expired</Code> or <Code>review</Code>.</LI>
      </UL>
      <P>
        An employer can send a contractor an invitation link, valid for seven days, so the
        contractor can confirm their own payout wallet instead of the employer typing it. Only a
        hash of the invitation token is stored.
      </P>

      <H2 id="run">A pay run, step by step</H2>
      <H3 id="draft">1. Draft</H3>
      <P>
        A run names a pay cycle, one network and 1 to 100 contractors. The quote is the sum of the
        selected monthly amounts plus a processing fee of 35 basis points per line. A run may total
        at most 1,000,000 USDC. The response also carries a seat quote of 19 USD per active
        contractor; that figure is a quote shown in the workspace and is not charged by this flow.
      </P>

      <H3 id="prepare">2. Prepare</H3>
      <P>The employer supplies the wallet that will pay. Before returning anything to sign, the server checks that:</P>
      <UL>
        <LI>every selected contractor is active, has a <Code>verified</Code> tax status and unchanged payout details;</LI>
        <LI>the network has an enabled router deployment, and the bytecode at that address still matches the recorded code hash;</LI>
        <LI>the router reports the expected USDC token and fee treasury, and is not paused;</LI>
        <LI>the payer, the router, the fee treasury and every recipient pass address screening and the USDC issuer blocklist.</LI>
      </UL>
      <P>
        If all checks pass, the run becomes <Code>prepared</Code> with a 15-minute deadline and the
        response contains EIP-712 typed data (domain <Code>FurlPayRouter</Code>, version 1) for the
        employer&apos;s wallet. A failed or unavailable screen blocks signing.
      </P>

      <H3 id="sign">3. Sign and submit</H3>
      <P>
        The employer&apos;s wallet signs the authorisations and submits one <Code>batchPay</Code>{" "}
        transaction to the router. This is atomic: either every line pays or none does. Atomic
        payroll is limited to EVM networks; a Solana run is refused because it needs a separate
        execution rail that is not built.
      </P>

      <H3 id="verify">4. Verify</H3>
      <P>
        The employer reports the transaction hash. The server fetches the receipt and requires one{" "}
        <Code>PaymentExecuted</Code> event per line with the exact recipient, amount, fee and nonce,
        emitted by the approved router. It waits for the network&apos;s confirmation depth and
        checks that the block falls inside the authorisation window. Only then is the run marked{" "}
        <Code>settled</Code>.
      </P>
      <ParameterTable
        params={[
          { name: "draft", type: "status", required: true, desc: "Saved; nothing has been signed." },
          { name: "prepared", type: "status", required: true, desc: "Checks passed; typed data issued; deadline running." },
          { name: "submitted", type: "status", required: true, desc: "A transaction was reported and is awaiting confirmation." },
          { name: "settled", type: "status", required: true, desc: "Every line was found in a confirmed receipt." },
          { name: "review", type: "status", required: true, desc: "The run needs manual review, for example the approved router changed." },
          { name: "expired", type: "status", required: true, desc: "The authorisation deadline passed." },
        ]}
      />

      <H2 id="api">API</H2>
      <EndpointTable
        rows={[
          { method: "GET", path: "/api/merchant/payroll", desc: "Roster, runs, documents and pricing for the signed-in employer" },
          { method: "POST", path: "/api/merchant/payroll", desc: "{ action: \"contractor\" | \"batch\" } — add a contractor or draft a run" },
          { method: "PATCH", path: "/api/merchant/payroll", desc: "{ action: \"archive\" | \"prepare\" | \"verify\" }" },
          { method: "GET / POST", path: "/api/payouts/payroll/contractors", desc: "List or add contractors" },
          { method: "POST", path: "/api/payouts/payroll/contractors/invite", desc: "Create a seven-day wallet-link invitation" },
          { method: "GET / PATCH", path: "/api/payouts/payroll/contractors/me", desc: "Contractor side: view or link the payout wallet" },
          { method: "GET / POST", path: "/api/payouts/payroll/batches", desc: "List or draft runs" },
          { method: "GET / POST", path: "/api/payouts/payroll/documents", desc: "List or request tax and remittance documents" },
          { method: "POST", path: "/api/webhooks/payroll-provider", desc: "Signed status events from the deployment's banking and tax provider" },
        ]}
      />
      <P>All employer routes require a signed-in session and are rate limited per account.</P>

      <H2 id="documents">Tax and remittance documents</H2>
      <P>
        A document request (<Code>W9</Code>, <Code>W8BEN</Code>, <Code>W8BENE</Code> or{" "}
        <Code>FIRA</Code>) is forwarded to a provider adapter that the deployment owns. FurlPay does
        not generate tax forms or remittance certificates itself. A FIRA request is only accepted
        for a contractor in India, with an invoice reference, against a run that has already
        settled.
      </P>
      <P>
        The provider&apos;s acknowledgement never verifies a form or issues a document by itself.
        Status changes arrive later through the signed provider webhook. With no provider
        configured, document requests return <Code>503</Code>.
      </P>

      <H2 id="provider">Provider adapter contract</H2>
      <UL>
        <LI><Code>PAYROLL_PROVIDER_URL</Code> — HTTPS base URL. Requests are <Code>POST {"{url}"}/requests</Code> with a bearer key and an <Code>Idempotency-Key</Code> header.</LI>
        <LI><Code>PAYROLL_PROVIDER_API_KEY</Code> — bearer credential for outbound requests.</LI>
        <LI><Code>PAYROLL_PROVIDER_WEBHOOK_SECRET</Code> — at least 32 characters. Inbound events must carry <Code>X-FurlPay-Timestamp</Code> and <Code>X-FurlPay-Signature</Code>, where the signature is hex HMAC-SHA256 of <Code>timestamp + &quot;.&quot; + raw body</Code>. Events older than five minutes are rejected.</LI>
      </UL>

      <H2 id="virtual-accounts">Virtual bank accounts</H2>
      <P>
        <Code>/api/banking/virtual-accounts</Code> records a request for a USD, EUR, GBP, INR or AED
        account for a verified business. A request is not an account: it stays{" "}
        <Code>requested</Code> until the configured provider reports it active, and the response
        states <Code>issuance: &quot;provider_required&quot;</Code> when no provider is configured.
        FurlPay does not issue bank accounts and never displays invented account details.
      </P>

      <H2 id="batch-intents">Batch payout intents</H2>
      <P>
        <Code>POST /api/payouts/batch</Code> is a different, older flow. It creates up to 100
        independent USDC payment intents on Arbitrum in one call. It is not an atomic transfer: each
        line must be signed and settled on its own. Every recipient is screened first, and no intent
        is created unless all recipients are allowed. In production this route depends on the
        payment rail being configured.
      </P>

      <H2 id="setup">Setup</H2>
      <UL>
        <LI>Supabase configured, with migrations <Code>0040</Code>, <Code>0042_payroll_and_banking_workspace</Code> and <Code>0043_payroll_provider_and_wallets</Code> applied.</LI>
        <LI><Code>FURLPAY_BENEFICIARY_ENCRYPTION_KEY</Code> for encrypted contractor contact storage.</LI>
        <LI>A reviewed router deployment inserted into <Code>payroll_router_deployments</Code> (network, router address, runtime code hash, fee treasury, enabled). The router contract in this repository has not been independently audited.</LI>
        <LI>Node endpoints for each payroll network, as for merchant payments.</LI>
        <LI>The three <Code>PAYROLL_PROVIDER_*</Code> variables, once a banking and tax provider is contracted.</LI>
      </UL>

      <DocPager pathname="/docs/payments/payroll" />
    </article>
  );
}
