import { DocTitle, Lead, H2, P, Code, Callout, ParameterTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/transaction-statuses");

export default function TxStatusHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Understanding payment statuses</DocTitle>
      <Lead>
        Status names and transitions vary by API and rail. Read the response for the specific
        route; a prepared request, payment ID or accepted HTTP response is not proof that funds
        settled.
      </Lead>

      <H2 id="common">Common status meanings</H2>
      <ParameterTable
        params={[
          { name: "prepared", type: "not submitted", required: false, desc: "The route built an intent or transaction data. No chain transaction is implied." },
          { name: "pending", type: "in progress", required: false, desc: "A request was submitted or accepted and is awaiting a later confirmation or review." },
          { name: "pending_review", type: "manual review", required: false, desc: "A policy requires a human decision before a payment can proceed." },
          { name: "settled", type: "confirmed", required: false, desc: "The route reports successful settlement. Verify the transaction reference on the stated network." },
          { name: "failed", type: "unsuccessful", required: false, desc: "The route did not report successful settlement. Inspect the error and check the chain before retrying." },
          { name: "rejected", type: "not accepted", required: false, desc: "Validation, policy, availability or authorization checks refused the request." },
        ]}
      />
      <P>
        A <Code>202 Accepted</Code> response means processing is pending; it is not a settlement
        receipt. A <Code>503</Code> or missing status means the service cannot confirm availability.
      </P>

      <H2 id="verify">Verify an on-chain transaction</H2>
      <P>
        When the API returns a transaction hash, check it on the explorer for the exact network in
        the response. Compare the sender, recipient, token and amount. Wait for the chain&apos;s
        required confirmations before treating the transfer as complete.
      </P>

      <H2 id="retry">Before retrying</H2>
      <P>
        Do not submit a second payment while the first one is pending or its status is unknown.
        Check the original payment ID and transaction hash first. Use the documented idempotency
        behavior for that route, and contact{" "}
        <a href="/support" className="text-neon hover:underline">FurlPay Support</a> if the API
        status and chain evidence disagree.
      </P>

      <Callout type="warning" title="Availability is separate from status">
        A route may prepare an intent while its settlement rail is unavailable. Check{" "}
        <Code>/api/rails</Code> before creating a payment, and never interpret a quote or challenge
        as a completed transfer.
      </Callout>

      <DocPager pathname="/docs/help/transaction-statuses" />
    </article>
  );
}
