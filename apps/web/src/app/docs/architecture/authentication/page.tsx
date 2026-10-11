import { DocTitle, Lead, H2, P, UL, LI, Code, CodeBlock, Callout, EndpointTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/architecture/authentication");

export default function AuthenticationPage() {
  return (
    <article>
      <DocTitle eyebrow="Architecture">Authentication</DocTitle>
      <Lead>
        Human sessions use account authentication, registered agents can use owned signing keys
        and policies, and MCP clients use scoped authorization. The x402 protocol is public, but
        FurlPay&apos;s endpoint currently returns 503 and production settlement is gated separately.
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
        (<Code>Signature-Input</Code> + <Code>Content-Digest</Code>). FurlPay endpoints that use
        agent spend authorization can enforce the key&apos;s per-transaction limit, daily budget and
        category allowlist. See{" "}
        <a href="/docs/payments/agent-trust" className="text-neon hover:underline">Agent Trust &amp; Mandates</a>.
      </P>

      <H2 id="x402">Public x402 endpoint status</H2>
      <P>
        The x402 protocol can issue a payment challenge without an account or API key. FurlPay&apos;s
        x402 endpoint returned <Code>503 controls_unavailable</Code> with reason <Code>plan_limit</Code>
        on 11 October 2026. If the endpoint becomes available, a challenge still does not guarantee
        settlement or delivery of a paid resource:
      </P>
      <CodeBlock lang="bash">{`curl "https://furlpay.com/api/x402/fx?from=USD&to=EUR&amount=100"
# current production response: 503 when rail controls are unavailable
# do not assume a 402 challenge or successful settlement`}</CodeBlock>

      <H2 id="keys">API keys</H2>
      <P>
        API-key formats and authentication requirements vary by route. A developer credential
        does not enable a disabled payment rail and should not be assumed to replace a user session
        where the route requires one. Keep secret credentials server-side and follow the
        authentication contract for the endpoint you call.
      </P>

      <Callout type="warning" title="Never send credentials in query strings">
        Session cookies, signatures, and payment headers all travel in headers or cookies. Query-string
        secrets end up in access logs and referrer headers — requests shaped that way are rejected.
      </Callout>

      <DocPager pathname="/docs/architecture/authentication" />
    </article>
  );
}
