import { DocTitle, Lead, H2, P, UL, LI, Code, CodeBlock, Callout, EndpointTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/architecture/webhooks");

export default function WebhooksPage() {
  return (
    <article>
      <DocTitle eyebrow="Architecture">Webhook Events</DocTitle>
      <Lead>
        Every webhook handler verifies a signature over the raw body before trusting a byte, rejects
        stale timestamps, and fails closed when its secret is unset. This page lists the inbound
        handlers and shows how to verify events Furlpay sends you.
      </Lead>

      <H2 id="inbound">Inbound handlers</H2>
      <EndpointTable
        rows={[
          { method: "POST", path: "/api/webhooks/stripe", desc: "Stripe events — stripe-signature verified via constructEvent" },
          { method: "POST", path: "/api/webhooks/sumsub", desc: "Sumsub KYC outcomes — HMAC digest over the raw body" },
          { method: "POST", path: "/api/webhooks/persona", desc: "Persona inquiry outcomes — persona-signature HMAC" },
          { method: "POST", path: "/api/webhooks/wise", desc: "Wise transfer state changes — signature verified" },
          { method: "POST", path: "/api/webhooks/bridge", desc: "Bridge fiat rail events — signature verified" },
          { method: "POST", path: "/api/webhooks/marqeta", desc: "Card processor callbacks (JIT funding, auth events)" },
          { method: "POST", path: "/api/webhooks/card-auth", desc: "3DS2 card authentication events — endpoint secret" },
        ]}
      />
      <UL>
        <LI>Signatures are computed over the <b>raw</b> request body — parse only after verification.</LI>
        <LI>Comparisons are constant-time; timestamped schemes reject events older than the tolerance window.</LI>
        <LI>A handler whose secret is not configured refuses the event (fail closed) rather than accepting unsigned input.</LI>
        <LI>Webhooks are exempt from the mutating-request IP rate-limit baseline (providers batch deliveries from few IPs) — the signature is the gate.</LI>
      </UL>

      <H2 id="verify">Verifying events from Furlpay</H2>
      <P>
        Events delivered to your endpoint carry a <Code>Furlpay-Signature</Code> header: an HMAC-SHA256
        over <Code>{"timestamp + \".\" + rawBody"}</Code> with your endpoint secret. Verify before
        trusting:
      </P>
      <CodeBlock lang="typescript" filename="app/api/webhooks/furlpay/route.ts">{`import crypto from "crypto";

export async function POST(req: Request) {
  const raw = await req.text();                       // RAW body — do not parse first
  const sig = req.headers.get("furlpay-signature") ?? "";
  const ts = req.headers.get("furlpay-timestamp") ?? "";

  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
    return new Response("stale", { status: 400 });    // replay window: 5 minutes
  }
  const expected = crypto
    .createHmac("sha256", process.env.FURLPAY_WEBHOOK_SECRET!)
    .update(\`\${ts}.\${raw}\`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return new Response("bad signature", { status: 401 });
  }

  const event = JSON.parse(raw);                      // safe to parse now
  // handle event.type ...
  return new Response("ok");
}`}</CodeBlock>

      <H2 id="local">Local development</H2>
      <P>Forward live events to localhost with the CLI — it prints the signing secret to verify against:</P>
      <CodeBlock lang="bash">{`furlpay listen --forward-to localhost:3000/api/webhooks/furlpay`}</CodeBlock>

      <Callout type="danger" title="Never credit balances from an unverified event">
        A webhook body is attacker-controllable input until the signature passes. Verify first, act
        second, and make handlers idempotent — providers redeliver.
      </Callout>

      <DocPager pathname="/docs/architecture/webhooks" />
    </article>
  );
}
