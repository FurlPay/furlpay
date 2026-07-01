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
      <p className="mb-6 text-[13px] text-textMuted">Last updated: July 2, 2026</p>
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
