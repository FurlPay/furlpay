import { DocTitle, Lead, H2, P, UL, LI, Code, Callout, DocPager } from "@/components/docs/prose";

export const metadata = { title: "Furlpay Docs — MPC & WebAuthn" };

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
        Login uses <b>WebAuthn / FIDO2</b> passkeys — fingerprint or Face ID, no passwords. Credentials are
        bound to the registrable domain via <Code>FURLPAY_RP_ID</Code>, so a phishing origin can never
        replay them.
      </P>

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
