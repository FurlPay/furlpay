import { DocTitle, Lead, H2, P, UL, LI, Code, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/security/mpc-webauthn");

export default function SecurityPage() {
  return (
    <article>
      <DocTitle eyebrow="Security &amp; Crypto">MPC &amp; WebAuthn</DocTitle>
      <Lead>
        Custody-grade security with consumer-grade UX. Keys are split, signing is policy-gated, logins are
        phishing-resistant, and every transfer passes a real-time risk check.
      </Lead>

      <H2 id="mpc">2-of-2 MPC signing</H2>
      <P>
        Wallet keys never exist as a single secret. Each signature requires a{" "}
        <b>2-of-2 multi-party computation</b> between the user&apos;s device share and Furlpay&apos;s
        server share. Neither party can move funds alone, and there is no full private key to leak.
      </P>
      <UL>
        <LI>Device share — bound to the user&apos;s hardware, unlocked by a passkey.</LI>
        <LI>Server share — held under HSM policy, released only when policy passes.</LI>
      </UL>

      <H2 id="hsm">Turnkey HSM policy</H2>
      <P>
        The server share lives behind a <Code>Turnkey</Code> HSM. A declarative policy engine enforces
        who can sign what, under which limits — evaluated inside the secure enclave before any co-signature
        is produced.
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
