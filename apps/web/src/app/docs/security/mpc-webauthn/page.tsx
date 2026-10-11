import { DocTitle, Lead, H2, P, UL, LI, Code, Callout, DocPager, Mermaid } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/security/mpc-webauthn");

export default function SecurityPage() {
  return (
    <article>
      <DocTitle eyebrow="Security &amp; Crypto">Signing &amp; WebAuthn</DocTitle>
      <Lead>
        The web application uses passkeys for authentication and a remote signing service for some
        wallet actions. Passkey authentication is not the same as user-held wallet keys or threshold
        signing. This page describes the current web path and its limits.
      </Lead>

      <Callout title="Correction: this page previously described 2-of-2 MPC">
        It said wallet keys were split between a device share and a server share, and that neither party
        could move funds alone. That was <b>not</b> what the code did. The web signing path returns a
        <b> complete</b> signature from a remote enclave; the device holds no key share. The description
        below is the accurate one, and{" "}
        <Code>docs/CUSTODY-DISCLOSURE.md</Code> in the repository records the correction in full.
      </Callout>

      <H2 id="paths">Signing model in the web application</H2>
      <P>
        Mobile client source exists in the repository, but FurlPay does not currently distribute a
        production mobile app. Do not treat unreleased client code as an available self-custody product.
      </P>
      <P>
        <b>Web app — custodial.</b> Signing runs through <Code>/api/mpc/sign</Code> to a secure enclave
        operated by <Code>Turnkey</Code>, which signs the digest and returns a complete signature. The
        client verifies that the signature recovers to the expected address, which is a correct check —
        but it is verification, not participation in a threshold scheme. Anything holding the Turnkey
        organisation credential can, subject to enclave policy, produce signatures for wallets in that
        organisation. That makes this path custodial.
      </P>
      <P>
        Furlpay deliberately calls <Code>signRawPayload</Code> rather than letting Turnkey build and sign
        the whole transaction: the client serialises the transaction and computes the digest itself, so
        the address-recovery check is not Turnkey checking Turnkey.
      </P>

      <H2 id="policy">Policy checks are not threshold signing</H2>
      <P>
        The property with genuine independence is <b>authorisation</b>, not key material. A signature
        request must survive three gates, each able to refuse without opening the others:
      </P>
      <UL>
        <LI>The <b>client</b> refuses to request an out-of-policy signature.</LI>
        <LI><Code>/api/mpc/sign</Code> refuses to forward one (<Code>lib/services/policyEngine.ts</Code>).</LI>
        <LI>Turnkey&apos;s <b>enclave policy</b> refuses to produce one.</LI>
      </UL>
      <P>
        That is real defence in depth. It is just not key-share splitting, and the old copy conflated the
        two.
      </P>

      <H2 id="threshold">What would make true threshold signing real</H2>
      <P>
        A device-held share that is <i>required</i> to produce a signature — each side computing a partial
        signature, neither sufficient alone. That is on the roadmap and is <b>not built</b>. Until it ships
        and is verified end to end, this page describes the web path as custodial.
      </P>

      <H2 id="webauthn">WebAuthn passkeys</H2>
      <P>
        Login uses <b>WebAuthn / FIDO2</b> passkeys — fingerprint or Face ID, no passwords. The Relying
        Party ID is resolved from explicit server configuration (<Code>FURLPAY_RP_ID</Code> / Vercel deploy
        URL), <b>never</b> from the client-controlled <Code>Host</Code> header — the single most common
        WebAuthn deployment mistake, and the one that lets a reverse-proxy phishing origin bind credentials.
        Assertions verify against an allow-list of origins and RP IDs.
      </P>
      <UL>
        <LI>Registration and assertion run through <Code>@simplewebauthn/server</Code> (origin, challenge, and signature-counter checks).</LI>
        <LI>Credentials are bound to the registrable eTLD+1, so they can never be replayed on another domain.</LI>
      </UL>
      <Mermaid
        caption="Passkey authentication ceremony: server-issued challenge, authenticator assertion, server-side verification, signed session."
        chart={`sequenceDiagram
    participant User
    participant Browser
    participant Authenticator as Platform Authenticator
    participant Server as Furlpay API

    User->>Browser: Sign in
    Browser->>Server: POST /api/auth/webauthn (request options)
    Server-->>Browser: challenge + allowed RP ID and origins
    Browser->>Authenticator: navigator.credentials.get()
    Authenticator->>User: Biometric prompt (Face ID / fingerprint)
    User-->>Authenticator: approve
    Authenticator-->>Browser: signed assertion (bound to RP ID)
    Browser->>Server: assertion + clientDataJSON
    Server->>Server: verify origin, challenge, signature counter
    Server-->>Browser: HttpOnly signed session cookie
    Note over Server: RP ID comes from server config,<br/>never the Host header`}
      />

      <H2 id="sessions">Signed sessions</H2>
      <P>
        A successful passkey ceremony mints a short-lived, HttpOnly session cookie — a signed JWT
        (<Code>jose</Code>, HS256) verified in edge middleware, so tampered or expired tokens are rejected
        before any handler runs. The signing secret is <b>required</b> in production; the app refuses to
        start with the weak development fallback.
      </P>

      <H2 id="agentic">Agentic payment security (x402)</H2>
      <P>
        Production x402 is currently unavailable: on 11 October 2026 the endpoint returned{" "}
        <Code>503 controls_unavailable</Code> with reason <Code>plan_limit</Code>. Settlement is
        also in development, so an issued challenge is not proof that a payment can complete or a
        paid response will be delivered. Check the rail status and the{" "}
        <a href="/docs/payments/agentic-x402" className="text-neon hover:underline">x402 guide</a>{" "}
        before integrating.
      </P>
      <UL>
        <LI>Validate the challenge fields and pay-to address before presenting a wallet signature request.</LI>
        <LI>Release a paid resource only after the configured facilitator confirms settlement.</LI>
        <LI>Do not treat a prepared authorization, challenge or pending status as a completed payment.</LI>
      </UL>

      <Callout title="Production boundary">
        FurlPay-operated settlement is not currently enabled. External security audits for the
        settlement contracts are also pending; see the{" "}
        <a href="/docs/security/posture" className="text-neon hover:underline">security posture</a>{" "}
        page for the current audit statement.
      </Callout>

      <DocPager pathname="/docs/security/mpc-webauthn" />
    </article>
  );
}
