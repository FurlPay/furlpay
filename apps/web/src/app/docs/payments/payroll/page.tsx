import { DocTitle, Lead, H2, H3, P, UL, LI, Code, Callout, EndpointTable, ParameterTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/payments/payroll");

export default function PayrollPage() {
  return (
    <article>
      <DocTitle eyebrow="Payments">Contractor payroll and payouts</DocTitle>
      <Lead>
        Payroll lets an employer keep a contractor roster, draft a monthly pay run in USDC and
        authorise each line from their own wallet. FurlPay screens recipients, issues the data to
        sign and reads the result back from the chain. Payroll is non-custodial: FurlPay never holds
        the payroll funds and never signs the transfer.
      </Lead>

      <Callout type="warning" title="Status: implemented, execution blocked by an external dependency">
        Rosters, drafts, screening, signing and contractor self-service are implemented and tested.
        On-chain execution needs a reviewed <Code>FurlPayRouter</Code> contract deployed on the
        run&apos;s network and its address configured. No router address is configured in
        production, so production cannot issue a signable pay run. The router contract has not been
        independently audited.
      </Callout>

      <H2 id="roster">Contractor roster</H2>
      <P>Each contractor record holds a name, email, optional role, two-letter country code, payout network, payout wallet address and a default amount in USDC.</P>
      <UL>
        <LI><b>Networks:</b> Arbitrum, Arc, Base and Polygon. Payout addresses are EVM addresses.</LI>
        <LI><b>CSV import:</b> validation is all-or-nothing. Any invalid row imports nothing and every error is listed. Emails already on the roster are skipped, never overwritten.</LI>
        <LI><b>Recipients come from the roster.</b> A pay run can only pay addresses the employer saved beforehand, never an address supplied in the run request.</LI>
      </UL>

      <H3 id="self-service">Contractor self-service</H3>
      <UL>
        <LI>The employer sends an invitation: a single-use link valid for seven days. Only a hash of the token is stored, and the token travels in the URL fragment so it does not reach server logs.</LI>
        <LI>The contractor accepts while signed in with the same email as the roster entry. That links their account.</LI>
        <LI>The contractor sets their own payout address by signing a registration message with that address (EIP-191). The address is screened first; a flagged address or a screening outage keeps the current address.</LI>
        <LI>Once a contractor has linked their account, their identity and the address their wallet proved can no longer be changed by the employer.</LI>
      </UL>

      <H2 id="run">A pay run, step by step</H2>
      <H3 id="draft">1. Draft and screen</H3>
      <P>
        A run names a cycle (<Code>YYYY-MM</Code>), one network and 1 to 100 roster lines. Creating
        it screens every recipient. If any recipient is flagged, or could not be screened, the whole
        run is <Code>blocked</Code> until the employer cancels it or excludes those recipients with a
        written note. Excluded recipients are recorded, never cleared.
      </P>

      <H3 id="submit">2. Submit</H3>
      <P>
        Submitting turns the draft into one payment intent per line, with EIP-712 data for the
        employer&apos;s wallet. Exactly one request can move a draft forward. In production this
        step is refused when no router address is configured for the network.
      </P>

      <H3 id="sign">3. Sign</H3>
      <P>
        The employer signs each line. The server checks every signature off-chain the same way the
        router will: the EIP-712 digest must recover to the payer, and malleable signatures are
        refused, so a stored signature is one the router can execute.
      </P>

      <H3 id="execute">4. Execute and record</H3>
      <P>
        The employer&apos;s wallet submits the batch to the router. The transaction hash the browser
        reports is treated only as a pointer. A line is marked executed only after the server
        re-reads the receipt and finds a <Code>PaymentExecuted</Code> event from the configured
        router whose payment ID, payer, recipient, amount, fee and nonce match what was signed, at
        the network&apos;s required depth, in a block that is still canonical. A partially executed
        run stays <Code>submitted</Code>; it is never reported as paid.
      </P>
      <ParameterTable
        params={[
          { name: "draft", type: "status", required: true, desc: "Saved and screened; nothing issued to sign." },
          { name: "blocked", type: "status", required: true, desc: "At least one recipient was flagged or could not be screened." },
          { name: "submitting", type: "status", required: true, desc: "Intents are being issued." },
          { name: "submitted", type: "status", required: true, desc: "Intents issued; lines are being signed or executed." },
          { name: "completed", type: "status", required: true, desc: "Every line was found executed on-chain." },
          { name: "cancelled", type: "status", required: true, desc: "Cancelled by the employer." },
        ]}
      />

      <H2 id="pricing">Fees</H2>
      <UL>
        <LI><b>Collected on-chain:</b> 35 basis points per line, rounded down, paid by the employer on top of the line.</LI>
        <LI><b>Quoted only:</b> a batch minimum of 1.50 USDC and a seat fee of 19 USDC per active contractor, once per month. Billing is not connected, so these are recorded as quotes and charge nobody.</LI>
      </UL>

      <H2 id="tax">Tax records</H2>
      <P>
        An employer can record that they hold a payee-signed W-9 or W-8BEN. This is a record, not
        an e-signature system. The tax ID, legal name and address are encrypted at rest; only the
        last four characters of the tax ID are stored in the clear, and no API response decrypts
        them.
      </P>
      <P>
        The tax summary is a 1099-NEC threshold watch for US contractors, totalling what was sent in
        submitted runs per calendar year. It cannot confirm what settled, it files nothing with any
        tax authority, and it is not tax advice.
      </P>

      <H2 id="reconciliation">Reconciliation</H2>
      <P>
        A scheduled job checks that every executed line&apos;s fee is journaled exactly once,
        re-reads recently executed lines from the chain, and reports runs that have been partially
        executed for more than a day. Findings become alerts. Nothing is corrected automatically:
        reversing a journal is an operator decision.
      </P>

      <H2 id="schedules">Recurring schedules</H2>
      <P>
        A schedule prepares payroll on a cadence: every week, every two weeks, or monthly on a
        day from 1 to 28. On each run date a daily job creates an ordinary draft batch from the
        saved roster, with every recipient screened and the fees quoted, exactly as if the employer
        had created it by hand. It never pays anyone. The employer reviews the draft, submits it and
        signs each line from their own wallet, as for any other batch.
      </P>
      <UL>
        <LI>Recipients and default amounts are read when the run happens, so a contractor&apos;s current verified address is used.</LI>
        <LI>A run that cannot be prepared, for example because a contractor was deactivated or moved to another network, is recorded on the schedule as failed with the reason, and the schedule moves on to its next date.</LI>
        <LI>Each run has a fixed batch ID derived from the schedule and the run date, so a retried or doubled run creates one batch.</LI>
        <LI>If the job was not running, missed periods are prepared on the next pass, up to six per schedule. Resuming a paused schedule does not prepare the periods it was paused for.</LI>
      </UL>

      <H2 id="analytics">Analytics</H2>
      <P>
        <Code>GET /api/payouts/payroll/analytics?months=6</Code> returns totals by month, status,
        network and contractor for the last 1 to 24 months. Three amounts are kept apart: paid
        (lines whose execution was verified on-chain), pending (submitted lines not yet executed)
        and prepared (draft and blocked batches). Fees are the quotes recorded with each batch.
        Cancelled batches are counted by status and nowhere else.
      </P>

      <H2 id="api">API</H2>
      <EndpointTable
        rows={[
          { method: "GET / POST / PATCH", path: "/api/payouts/payroll/contractors", desc: "List, add or update roster entries" },
          { method: "POST", path: "/api/payouts/payroll/contractors/import", desc: "CSV roster import, all-or-nothing" },
          { method: "POST", path: "/api/payouts/payroll/contractors/{id}/invite", desc: "Create a seven-day single-use invitation" },
          { method: "POST", path: "/api/payouts/payroll/contractors/{id}/tax", desc: "Record a W-9 or W-8BEN the employer holds" },
          { method: "POST", path: "/api/payouts/payroll/invite", desc: "Contractor side: preview or accept an invitation" },
          { method: "GET / PATCH", path: "/api/payouts/payroll/me", desc: "Contractor side: own profiles; set the payout address with a signature" },
          { method: "GET / POST / PATCH", path: "/api/payouts/payroll/batches", desc: "List runs; create a draft; submit, sign, cancel, reissue, exclude unscreened, record execution" },
          { method: "GET", path: "/api/payouts/payroll/tax-summary?year=", desc: "1099-NEC threshold watch" },
          { method: "GET / POST / PATCH", path: "/api/payouts/payroll/schedules", desc: "List, create, pause, resume or edit recurring schedules" },
          { method: "GET", path: "/api/payouts/payroll/analytics?months=", desc: "Paid, pending and prepared totals by month, status, network and contractor" },
          { method: "GET / POST", path: "/api/payouts/payroll", desc: "Saved roster; run payroll for a roster in the request body" },
        ]}
      />
      <P>All routes require a signed-in session and are rate limited per account. The contractor invitation page is <Code>/payroll/join</Code>.</P>

      <H2 id="setup">Setup</H2>
      <UL>
        <LI>Supabase configured, with migrations <Code>0042_payroll_and_merchant_extensions</Code>, <Code>0044_payroll_contractor_self_service</Code> and <Code>0048_payroll_exclusions_and_fee_ledger</Code> applied, and <Code>0051_payroll_schedules</Code> for recurring schedules.</LI>
        <LI>A router address per network: <Code>FURLPAY_ROUTER_ADDRESS_ARBITRUM</Code>, <Code>_ARC</Code>, <Code>_BASE</Code>, <Code>_POLYGON</Code>. The unsuffixed <Code>FURLPAY_ROUTER_ADDRESS</Code> is read for Arbitrum only; a router is never assumed to exist at the same address on another network.</LI>
        <LI><Code>FURLPAY_TAX_ENCRYPTION_KEY</Code> for sealed tax records.</LI>
        <LI>Node endpoints for each payroll network.</LI>
        <LI>The <Code>merchant-reconcile</Code> scheduled job, which also runs payroll reconciliation.</LI>
        <LI>The <Code>payroll-schedules</Code> scheduled job, which prepares the drafts of recurring schedules.</LI>
      </UL>

      <Callout type="info" title="Not offered">
        FurlPay does not issue bank accounts, generate tax forms, file tax returns or pay
        contractors in local currency. Payroll moves USDC from the employer&apos;s wallet to
        contractor wallets and nothing else.
      </Callout>

      <DocPager pathname="/docs/payments/payroll" />
    </article>
  );
}
