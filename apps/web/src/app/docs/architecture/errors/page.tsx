import { DocTitle, Lead, H2, P, UL, LI, Code, CodeBlock, Callout, ParameterTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/architecture/errors");

export default function ErrorCodesPage() {
  return (
    <article>
      <DocTitle eyebrow="Architecture">Error Codes</DocTitle>
      <Lead>
        Errors are boring on purpose: a machine-readable code, an optional human detail, and the right
        HTTP status. Nothing sensitive ever rides an error body.
      </Lead>

      <H2 id="shapes">Response shapes</H2>
      <P>Product APIs return a flat error object; ops APIs use the envelope with a request id:</P>
      <CodeBlock lang="json" filename="product API error">{`{ "error": "amount_over_limit", "detail": "amount exceeds the per-transaction limit ($500)" }`}</CodeBlock>
      <CodeBlock lang="json" filename="ops API error">{`{
  "ok": false,
  "error": { "code": "reason_required", "message": "A reason (min 8 chars) is required." },
  "meta": { "requestId": "req_…", "timestamp": "2026-07-12T00:00:00Z" }
}`}</CodeBlock>
      <P>
        When its operational controls are available, the x402 endpoint returns <Code>402</Code> with
        an <Code>error</Code> string and a fresh <Code>accepts</Code> quote. A control-plane failure
        returns <Code>503</Code> instead; on 11 October 2026 the production x402 endpoint returned
        <Code>503 controls_unavailable</Code> with reason <Code>plan_limit</Code>.
      </P>

      <H2 id="statuses">HTTP status conventions</H2>
      <UL>
        <LI><Code>400</Code> — validation failed (zod), malformed payload, bad parameters.</LI>
        <LI><Code>401</Code> — no valid session; <Code>402</Code> — payment required / payment rejected.</LI>
        <LI><Code>403</Code> — authenticated but forbidden (role, over-cap, policy).</LI>
        <LI><Code>409</Code> — conflict (replayed nonce, duplicate idempotency key with different body).</LI>
        <LI><Code>423</Code> — account locked; <Code>429</Code> — rate limited (check <Code>Retry-After</Code>).</LI>
        <LI><Code>502</Code> — upstream (chain RPC, provider) failed; <Code>503</Code> — feature not configured, rail paused, or operational controls unavailable.</LI>
      </UL>

      <H2 id="codes">Machine-readable codes</H2>
      <ParameterTable
        params={[
          { name: "amount_over_limit", type: "403", required: true, desc: "Amount exceeds the server-side per-transaction cap for the rail. The detail names the cap." },
          { name: "replay_rejected", type: "409 / 402", required: true, desc: "The EIP-3009 nonce or quote was already used. Sign a fresh authorization — never resign the same nonce." },
          { name: "invalid_signature", type: "400 / 402", required: true, desc: "Signature recovery did not match the payer (ECDSA and ERC-1271 both failed)." },
          { name: "rail_paused", type: "503", required: true, desc: "The rail is administratively paused. Retry after the status page clears." },
          { name: "controls_unavailable", type: "503", required: true, desc: "Current rail status cannot be read. Treat availability as unknown and do not submit a payment." },
          { name: "authorization_expired", type: "400", required: true, desc: "validBefore has passed. Sign a fresh authorization." },
          { name: "quote_expired", type: "402", required: true, desc: "The 402 quote TTL elapsed. Re-request the resource for a fresh quote." },
          { name: "settlement_pending", type: "202", required: false, desc: "Submitted on-chain but confirmation not yet observed. Poll pending.statusPath — do NOT sign a fresh authorization until it resolves." },
          { name: "service_unavailable", type: "503", required: true, desc: "The feature is not configured on this deployment (e.g. no on-chain relayer). Production never fabricates success." },
          { name: "reason_required", type: "400", required: true, desc: "Ops control changes require a typed reason for the audit trail." },
          { name: "unknown_page", type: "400", required: false, desc: "Docs feedback referenced a path outside the documentation." },
        ]}
      />

      <Callout type="info" title="Retries">
        Retry <Code>429</Code> after the <Code>Retry-After</Code> value and <Code>502</Code> with
        backoff. Never blind-retry <Code>402</Code> replay rejections or <Code>202</Code> pending
        settlements — both can double-pay; follow the recovery path in the body instead.
      </Callout>

      <DocPager pathname="/docs/architecture/errors" />
    </article>
  );
}
