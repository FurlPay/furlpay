import Link from "next/link";
import { DocTitle, Lead, H2, P, Callout } from "@/components/docs/prose";

export const metadata = {
  title: "Privacy Policy — Furlpay Legal",
  description:
    "How Furlpay handles personal data under GDPR, CCPA and GLBA — data minimization, on-chain privacy and hardware authentication.",
};

export default function PrivacyPage() {
  return (
    <article>
      <DocTitle eyebrow="Legal">Privacy Policy &amp; Data Safeguards</DocTitle>
      <p className="mb-6 text-[13px] text-textMuted">Last updated: July 18, 2026</p>
      <Lead>
        This policy explains how Furlpay collects, uses and protects your data. It is designed to meet the
        requirements of the GDPR, the CCPA and the Gramm-Leach-Bliley Act (GLBA).
      </Lead>

      <H2 id="minimization">Data minimization</H2>
      <P>
        Furlpay does not store raw KYC documents. All identity checks are processed directly by our secure
        verification partners (Sumsub / Persona) via tokenized APIs. We retain only the verification result
        and the minimal metadata required to meet our regulatory obligations.
      </P>

      <H2 id="on-chain">On-chain privacy</H2>
      <P>
        Public wallet addresses are indexed to build your transaction history. Private transaction details —
        such as recipient identities and notes — are stored encrypted off-chain and are never written to a
        public ledger.
      </P>

      <H2 id="hardware">Hardware authentication data</H2>
      <Callout title="Biometrics never leave your device">
        Biometric data (Face ID, Touch ID) used for WebAuthn passkeys never leaves your local device and is
        never transmitted to or stored on Furlpay&rsquo;s servers. Furlpay only ever sees the public key of
        your passkey credential.
      </Callout>

      <H2 id="extension">Browser extension</H2>
      <P>
        The FurlPay browser extension (Chrome, Edge and Firefox) is a companion to your
        furlpay.com account. Its data handling is deliberately minimal and is disclosed here in
        full, consistent with the Chrome Web Store and Firefox Add-ons requirements:
      </P>
      <P>
        <strong>What it accesses.</strong> The extension sends your existing furlpay.com session
        cookie with API requests to furlpay.com (first-party) so it can show your balance,
        approvals and activity. On web pages you visit it detects HTTP 402 &ldquo;Payment
        Required&rdquo; responses and shared FurlPay payment links, and announces a wallet provider
        to sites that request one (EIP-6963 / CAIP-294) — releasing your public smart-account
        address only after you approve that site in an explicit consent prompt.
      </P>
      <P>
        <strong>What it never does.</strong> It does not collect or transmit your browsing history,
        the content of pages you visit, keystrokes, form inputs or your location. It stores no seed
        phrases, private keys or session tokens; passkey signatures happen only on furlpay.com, the
        origin they are bound to. On-page UI is rendered inside an isolated (closed) shadow root so
        a page cannot read or interfere with it. All extension code is bundled and served locally —
        no remote code is loaded or executed. Locally cached data (UI preferences, the x402
        detection log, approved-site list) stays on your device and is size-bounded.
      </P>
      <P>
        This data is used only to provide the extension&rsquo;s single purpose above. It is not
        sold, not shared with third parties, and not used for advertising or any unrelated purpose.
      </P>

      <H2 id="rights">Your rights</H2>
      <P>
        Depending on your jurisdiction, you may have rights to access, correct, port or delete your personal
        data, and to object to certain processing. Requests are handled subject to the record-keeping
        obligations imposed on regulated financial services.
      </P>

      <div className="mt-12 border-t border-white/5 pt-6 text-[13px] text-textMuted">
        See our{" "}
        <Link href="/legal/terms" className="text-neon hover:underline">Terms of Service</Link> and{" "}
        <Link href="/legal/disclosures" className="text-neon hover:underline">Regulatory Disclosures</Link>.
      </div>
    </article>
  );
}
