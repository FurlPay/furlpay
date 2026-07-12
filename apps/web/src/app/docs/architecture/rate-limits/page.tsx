import { DocTitle, Lead, H2, P, UL, LI, Code, CodeBlock, Callout, ParameterTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/architecture/rate-limits");

export default function RateLimitsPage() {
  return (
    <article>
      <DocTitle eyebrow="Architecture">Rate Limits</DocTitle>
      <Lead>
        Two layers: a Redis-backed baseline that backstops every mutating call, and tighter per-route
        budgets on anything that moves money or sends messages. Limits hold across all serverless
        instances.
      </Lead>

      <H2 id="baseline">The baseline</H2>
      <P>
        Every mutating request (<Code>POST</Code>/<Code>PUT</Code>/<Code>PATCH</Code>/<Code>DELETE</Code>)
        passes a per-IP budget of <b>150 requests per minute</b> in the edge middleware. It is generous
        enough that no legitimate client hits it — it exists to blunt floods, not to meter usage.
        Signature-authenticated webhooks are exempt (providers batch deliveries from few IPs).
      </P>

      <H2 id="routes">Per-route budgets</H2>
      <ParameterTable
        params={[
          { name: "POST /api/transfers/gasless", type: "12 / min / IP", required: true, desc: "Gasless relay — each call can submit an on-chain transaction." },
          { name: "GET /api/rails", type: "60 / min / IP", required: true, desc: "Public rail discovery." },
          { name: "POST /api/docs/feedback", type: "10 / min / IP", required: true, desc: "Anonymous docs feedback counters." },
          { name: "GET /api/x402/fx", type: "quote-gated", required: true, desc: "Unpaid requests get quotes; each paid call is naturally metered by the payment itself." },
          { name: "OTP / email routes", type: "tight per-route", required: true, desc: "SMS/email-sending endpoints carry the strictest budgets to prevent pumping." },
        ]}
      />

      <H2 id="handling">Handling 429</H2>
      <P>A rejected request returns <Code>429</Code> with a <Code>Retry-After</Code> header (seconds):</P>
      <CodeBlock lang="typescript">{`const res = await fetch("/api/transfers/gasless", { method: "POST", body });
if (res.status === 429) {
  const wait = Number(res.headers.get("retry-after") ?? "5");
  await new Promise((r) => setTimeout(r, wait * 1000));
  // retry ONCE — if it 429s again, back off exponentially
}`}</CodeBlock>
      <UL>
        <LI>Respect <Code>Retry-After</Code> exactly — retrying earlier just resets your window.</LI>
        <LI>For agents: budget your call rate below the limit rather than treating 429 as flow control.</LI>
        <LI>x402 flows should reuse the pending-settlement poll path instead of re-requesting quotes in a loop.</LI>
      </UL>

      <Callout type="info" title="Limits are per deployment configuration">
        Budgets are conservative launch values and rise per rail as volume and monitoring mature. The
        values above are current defaults, not contractual ceilings.
      </Callout>

      <DocPager pathname="/docs/architecture/rate-limits" />
    </article>
  );
}
