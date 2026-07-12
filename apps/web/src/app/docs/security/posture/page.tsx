import { DocTitle, Lead, H2, P, UL, LI, Code, Callout, Badge, DocPager, EndpointTable } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/security/posture");

// Security posture, stated plainly. Every claim on this page is verifiable in
// the open-source repo or on-chain; the things that are NOT done yet (external
// audit) are stated just as plainly. Trust pages that overclaim are worse than
// no trust page.
export default function SecurityPosturePage() {
  return (
    <article>
      <DocTitle eyebrow="Security &amp; Crypto">Security Posture</DocTitle>
      <Lead>
        What protects your money at each layer — and the exact status of each guarantee. Everything
        here is verifiable: the code is open-source, settlements are on public chains, and the parts
        that are still pending are labeled pending.
      </Lead>

      <H2 id="custody">Non-custodial by construction</H2>
      <P>
        Furlpay never holds user funds in the payment path. x402 and gasless transfers move value with
        EIP-3009 <Code>transferWithAuthorization</Code> — the signed message itself fixes the payer,
        recipient, and amount, and the token contract re-verifies the signature on-chain. Our relayer
        pays gas; it cannot redirect a cent. CCTP bundles and LI.FI swaps are built server-side but{" "}
        <b>signed and submitted by the client</b>.
      </P>
      <UL>
        <LI><Badge>LIVE</Badge> EIP-712 signature recovery (ECDSA + ERC-1271 smart wallets), fail-closed.</LI>
        <LI><Badge>LIVE</Badge> Atomic cross-instance replay protection (Redis SET NX on every EIP-3009 nonce).</LI>
        <LI><Badge>LIVE</Badge> Amount-scaled confirmation depth before any resource is released.</LI>
        <LI><Badge>LIVE</Badge> Fabricated-settlement guard: production refuses to run money paths in mock mode.</LI>
      </UL>

      <H2 id="auth">Authentication</H2>
      <UL>
        <LI>WebAuthn / FIDO2 passkeys — phishing-resistant, hardware-backed where the device provides it. The Relying Party ID comes from server configuration, never the <Code>Host</Code> header.</LI>
        <LI>Step-up TOTP for privileged operations; MFA state writable only through the dedicated MFA route (mass-assignment is rejected schema-level).</LI>
        <LI>Sessions are short-lived signed JWTs in <Code>HttpOnly</Code> cookies; roles resolve from the user record on every request, and admin is pinned to a single founder account in production.</LI>
      </UL>

      <H2 id="controls">Money controls</H2>
      <UL>
        <LI>Hard per-transaction caps on every execution rail (swaps, CCTP, gasless transfers), enforced server-side.</LI>
        <LI>An ops control plane that can pause any rail — the pause is enforced at the route, not decorative.</LI>
        <LI>An append-only event ledger (Postgres triggers block update/delete) recording every settlement and every rejected attack: replays, bad signatures, tampered quotes, over-limit attempts.</LI>
        <LI>Agent spending is governed by user-signed mandates — an agent cannot widen its own permissions.</LI>
      </UL>

      <H2 id="pipeline">Continuous security pipeline</H2>
      <P>Every pull request runs:</P>
      <UL>
        <LI>Slither + Semgrep over the Solidity contracts.</LI>
        <LI>CodeQL over the application code.</LI>
        <LI>gitleaks secret scanning.</LI>
        <LI>Dependabot with a reasoned allowlist — <Code>npm audit fix --force</Code> is banned by policy.</LI>
      </UL>

      <H2 id="audits">External audits</H2>
      <Callout title="Current status — stated plainly">
        The smart contracts (<Code>X402Facilitator.sol</Code> and related) are{" "}
        <b>not yet externally audited</b>. Mainnet deployment of the contracts is paused until an audit
        engagement completes, and the live settlement path runs with conservative per-transaction caps.
        When reports are published they will be linked on this page. Internal review, the CI pipeline
        above, and adversarial end-to-end tests (replay, bad-signature, pending-settlement recovery)
        are in place today.
      </Callout>

      <H2 id="disclosure">Responsible disclosure</H2>
      <P>
        Found something? We run a coordinated disclosure program with safe harbor — see the{" "}
        <a href="/legal/responsible-disclosure" className="text-neon hover:underline">
          responsible disclosure policy
        </a>{" "}
        or email <Code>security@furlpay.com</Code>.
      </P>

      <H2 id="verify">Verify it yourself</H2>
      <EndpointTable
        rows={[
          { method: "GET", path: "/api/rails", desc: "Live status of every payment rail" },
          { method: "GET", path: "/api/x402/settlement/{tx}", desc: "Independently confirm any settlement on-chain" },
          { method: "GET", path: "/.well-known/security.txt", desc: "Security contact + policy" },
        ]}
      />
      <P>
        The application is open-source at{" "}
        <a href="https://github.com/FurlPay" className="text-neon hover:underline">github.com/FurlPay</a> —
        every claim above can be checked against the code.
      </P>

      <DocPager pathname="/docs/security/posture" />
    </article>
  );
}
