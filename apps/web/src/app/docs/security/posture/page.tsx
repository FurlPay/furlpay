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
        What protects a payment request at each layer, and which controls are available in
        production. The code describes more routes than are currently enabled for live settlement;
        the status of each rail must be checked separately.
      </Lead>

      <H2 id="custody">Client-signed payment flows</H2>
      <P>
        In routes that return wallet-signable transaction data, the connected wallet reviews,
        signs and submits the transaction. Those specific flows do not use FurlPay custody. This
        statement does not describe every wallet action; see the{" "}
        <a href="/docs/security/mpc-webauthn" className="text-neon hover:underline">signing disclosure</a>
        {" "}for the web signing model. EIP-3009{" "}
        <Code>transferWithAuthorization</Code> binds the payer, recipient and amount to the signed
        authorization. The production relayer-dependent x402 and gasless transfer rails are not
        currently enabled. CCTP bundles and LI.FI routes are prepared by the service but{" "}
        <b>signed and submitted by the client</b> when that route is available.
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
        engagement completes. FurlPay-operated production settlement is not currently enabled.
        When audit reports are published they will be linked on this page. Internal review, the CI
        pipeline above, and adversarial tests for replay, invalid signatures and pending-settlement
        recovery are maintained in the repository.
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
