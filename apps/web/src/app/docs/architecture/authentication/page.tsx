import { DocTitle, Lead, H2, P, UL, LI, Code, CodeBlock, Callout, EndpointTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/architecture/authentication");

export default function AuthenticationPage() {
  return (
    <article>
      <DocTitle eyebrow="Architecture">Authentication</DocTitle>
      <Lead>
        Three ways in, depending on who is calling: passkey sessions for humans, signed requests for
        registered agents, and x402 payments for anonymous agents — where the payment itself is the
        authentication.
      </Lead>

      <H2 id="sessions">Human sessions</H2>
      <P>
        Sign-in mints a short-lived signed JWT delivered as an <Code>HttpOnly</Code> cookie. The
        middleware verifies the signature (not just cookie presence) on every request; roles are then
        re-resolved from the user record — never trusted from the token alone — so a role change takes
        effect immediately.
      </P>
      <EndpointTable
        rows={[
          { method: "POST", path: "/api/auth/webauthn", desc: "Register / authenticate a passkey (FIDO2)" },
          { method: "POST", path: "/api/auth/otp/start", desc: "Phone / email OTP" },
          { method: "POST", path: "/api/auth/google", desc: "Sign in with Google Identity Services" },
          { method: "POST", path: "/api/auth/apple", desc: "Sign in with Apple" },
          { method: "POST", path: "/api/auth/guest", desc: "Demo guest session (never admin in production)" },
        ]}
      />
      <UL>
        <LI>Passkeys are the primary factor — phishing-resistant, bound to the registrable domain (RP ID from server config, never the <Code>Host</Code> header).</LI>
        <LI>Privileged operations require step-up TOTP; MFA state is only writable through <Code>/api/security/mfa</Code>.</LI>
        <LI>The <Code>admin</Code> role is pinned to a single founder account in production, and guest sessions can never hold it.</LI>
        <LI>A locked account returns <Code>423 Locked</Code> on every authenticated route until unlocked through the recovery flow.</LI>
      </UL>

      <H2 id="agents">Registered agents: signed requests</H2>
      <P>
        An agent registered via <Code>POST /api/agents/keys</Code> holds its own Ed25519 key bound to
        your account with a spend policy. Requests are signed with RFC 9421 HTTP Message Signatures
        (<Code>Signature-Input</Code> + <Code>Content-Digest</Code>), and the policy — per-transaction
        limit, daily budget, category allowlist — is enforced server-side on every spend. See{" "}
        <a href="/docs/payments/agent-trust" className="text-neon hover:underline">Agent Trust &amp; Mandates</a>.
      </P>

      <H2 id="x402">Anonymous agents: payment is the auth</H2>
      <P>
        Pay-per-call endpoints need no account and no API key. The signed EIP-3009 authorization in the{" "}
        <Code>X-PAYMENT</Code> header proves control of the paying wallet cryptographically — a stronger
        claim than a bearer key, scoped to exactly one payment:
      </P>
      <CodeBlock lang="bash">{`curl "https://furlpay.com/api/x402/fx?from=USD&to=EUR&amount=100"
# -> 402 with a quote. Sign it, retry with X-PAYMENT, get the resource.`}</CodeBlock>

      <H2 id="keys">API keys</H2>
      <P>
        The SDK quickstart uses <Code>sk_test_…</Code> keys against the sandbox. Production API-key
        issuance ships with the developer dashboard; server-side sessions and x402 cover every current
        production surface.
      </P>

      <Callout type="warning" title="Never send credentials in query strings">
        Session cookies, signatures, and payment headers all travel in headers or cookies. Query-string
        secrets end up in access logs and referrer headers — requests shaped that way are rejected.
      </Callout>

      <DocPager pathname="/docs/architecture/authentication" />
    </article>
  );
}
