import { DocTitle, Lead, H2, P, UL, LI, Code, Callout, DocPager, Mermaid } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/security/mpc-webauthn");

export default function SecurityPage() {
  return (
    <article>
      <DocTitle eyebrow="Security &amp; Crypto">Signing &amp; WebAuthn</DocTitle>
      <Lead>
        Two signing paths with two different custody models, a signing policy enforced independently in
        three places, and phishing-resistant passkey authentication. This page states which path is
        custodial, because the answer decides how much you should be willing to hold with us.
      </Lead>

      <Callout title="Correction: this page previously described 2-of-2 MPC">
        It said wallet keys were split between a device share and a server share, and that neither party
        could move funds alone. That was <b>not</b> what the code did. The web signing path returns a
        <b> complete</b> signature from a remote enclave; the device holds no key share. The description
        below is the accurate one, and{" "}
        <Code>docs/CUSTODY-DISCLOSURE.md</Code> in the repository records the correction in full.
      </Callout>

      <H2 id="paths">Two signing paths</H2>
      <P>
        <b>Mobile app — self-custodial.</b> A BIP-39 seed is generated on the device and stored in
        biometric-gated secure storage (Android Keystore / iOS Keychain). It is never transmitted, and
        Furlpay cannot reconstruct it. Lose the device and every backup, and the funds are gone — that is
        the real cost of self-custody, and we do not soften it.
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

      <H2 id="policy">What actually is 2-of-2: the policy path</H2>
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
        Furlpay&apos;s x402 endpoints let AI agents pay per request — where the payment <i>is</i> the auth,
        so payment verification is the entire security boundary. Our verifier is hardened against the four
        attack classes documented in 2026 research (arXiv 2605.11781 / 2605.30998):
      </P>
      <UL>
        <LI><b>Authorization</b> — every field (amount, recipient, network) is checked server-side; the client&apos;s copy of the quote is never trusted.</LI>
        <LI><b>Binding</b> — each quote carries an HMAC over <Code>(resource, method, amount, expiry)</Code>, so a payment for one endpoint can&apos;t unlock another.</LI>
        <LI><b>Replay</b> — quote IDs and EIP-3009 nonces are single-use with a short expiry window.</LI>
        <LI><b>Web-layer</b> — the <Code>X-PAYMENT</Code> header is size-capped and strictly parsed; malformed input returns 400, never a free resource.</LI>
      </UL>

      <H2 id="fraud">Real-time fraud — Sardine</H2>
      <P>
        Every transfer is scored by <Code>Sardine</Code> using device intelligence and biometric
        behavioural signals. High-risk actions trigger step-up MFA before the MPC co-signature is requested.
      </P>

      <H2 id="exploits">Gnosis Pay-class exploit prevention</H2>
      <P>
        Card and allowance flows are designed to prevent Gnosis Pay-style drain exploits: no unbounded
        approvals, per-authorization spend caps enforced at signing time, and settlement reconciled through
        the double-entry ledger so nothing moves without a matching entry.
      </P>

      <Callout title="Defense in depth">
        MPC removes single-key risk, HSM policy constrains signing, WebAuthn stops phishing, and Sardine
        gates behaviour — an attacker must defeat all four, not one.
      </Callout>

      <DocPager pathname="/docs/security/mpc-webauthn" />
    </article>
  );
}
