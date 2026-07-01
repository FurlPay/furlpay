import { DocTitle, Lead, H2, H3, P, UL, LI, Code, CodeBlock, Callout, DocPager } from "@/components/docs/prose";

export const metadata = { title: "Furlpay Docs — Persona KYC" };

export default function PersonaKycPage() {
  return (
    <article>
      <DocTitle eyebrow="Integrations">Persona KYC &amp; Biometric Liveness</DocTitle>
      <Lead>
        Identity and selfie verification with Persona — embedded in-domain during signup and high-limit
        upgrades. In Furlpay this is wired through <Code>components/PersonaKycButton.tsx</Code>,{" "}
        <Code>lib/kyc/persona.ts</Code> and the webhook route.
      </Lead>

      <H2 id="frontend">1. Frontend embed flow</H2>
      <P>
        Launch a Persona Inquiry using a configured <Code>Template ID</Code> (Selfie + Government ID). The
        embedded flow keeps the user within the Furlpay domain.
      </P>
      <CodeBlock lang="tsx">{`// components/PersonaKycButton.tsx
const client = new window.Persona.Client({
  templateId: process.env.NEXT_PUBLIC_PERSONA_TEMPLATE_ID!,
  referenceId: userId,          // maps the Furlpay user id to the inquiry
  environment: 'sandbox',       // 'production' for live verification
  onComplete: ({ inquiryId }) => onSuccess(inquiryId),
  onCancel: () => onCancel(),
  onError: (error) => console.error('Persona error:', error),
});
client.open();`}</CodeBlock>
      <Callout title="Load the SDK once">
        The reference snippet removed the Persona script on unmount, which breaks a re-open. Furlpay loads
        <Code>persona-v4.js</Code> once and caches it across mounts.
      </Callout>

      <H2 id="webhooks">2. Backend webhooks</H2>
      <P>
        Persona processes liveness asynchronously. Verify the <Code>persona-signature</Code> header before
        updating the user&rsquo;s account. Persona sends a hex HMAC-SHA256 over the <b>raw</b> body; during
        secret rotation the header carries multiple space-separated signature sets — so use a constant-time,
        rotation-aware comparison (never a plain <Code>!==</Code>).
      </P>
      <CodeBlock lang="typescript">{`// lib/kyc/persona.ts
import crypto from 'crypto';

export function verifyPersonaSignature(rawBody: string, header: string | null, secret: string) {
  if (!header || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  for (const segment of header.trim().split(/\\s+/)) {
    const v1 = Object.fromEntries(segment.split(',').map(kv => kv.split('=')))['v1'] ?? segment;
    if (v1.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'))) {
      return true;
    }
  }
  return false;
}`}</CodeBlock>
      <CodeBlock lang="typescript">{`// app/api/webhooks/persona/route.ts
export async function POST(request: Request) {
  const payload = await request.text();
  const sig = request.headers.get('persona-signature');
  if (!verifyPersonaSignature(payload, sig, process.env.PERSONA_WEBHOOK_SECRET!)) {
    return Response.json({ error: 'Signature verification failed' }, { status: 401 });
  }
  const event = JSON.parse(payload);
  if (event.eventType === 'inquiry.completed') {
    // UPDATE furlpay_database SET kyc_status = 'verified' WHERE user_id = referenceId
  }
  return Response.json({ received: true });
}`}</CodeBlock>

      <H2 id="advanced">3. Advanced 2026 API features</H2>
      <H3>Inquiry Search</H3>
      <P>
        Instead of paginating the list endpoint, filter registrations dynamically with the June 2026
        Inquiry Search API (requires <Code>Persona-Version: 2026-06-09</Code>).
      </P>
      <CodeBlock lang="typescript">{`await fetch('https://withpersona.com/api/v1/inquiries/search', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${process.env.PERSONA_API_KEY}\`,
    'Content-Type': 'application/json',
    'Persona-Version': '2026-06-09',
  },
  body: JSON.stringify({
    query: 'reference_id:"USER_ID" AND status:"completed" AND tags:"high_velocity"',
  }),
});`}</CodeBlock>
      <H3>KYB — Business Associated Persons</H3>
      <P>
        For corporate merchants, the Business Associated Persons report returns an
        <Code>ownership_information</Code> object listing ultimate beneficial owners (UBOs). Furlpay screens
        every owner against TRM Labs / sanctions databases automatically.
      </P>

      <H2 id="security">4. Biometric security best practices</H2>
      <UL>
        <LI>
          <b>Presentation Attack Detection (PAD):</b> run active &amp; passive liveness side-by-side to
          block deepfakes, screen replays and printed-mask attacks.
        </LI>
        <LI>
          <b>Strict device binding:</b> match device telemetry against historical signatures via the
          Sardine SDK to defeat virtual-camera injection.
        </LI>
        <LI>
          <b>Data segregation (GDPR):</b> Furlpay never stores biometric data, selfie streams or raw IDs —
          they stay encrypted in Persona&rsquo;s SOC2/ISO vaults. We retain only the{" "}
          <Code>inquiryId</Code> and a boolean <Code>verified</Code> for audit trails.
        </LI>
      </UL>

      <DocPager pathname="/docs/integrations/persona-kyc" />
    </article>
  );
}
