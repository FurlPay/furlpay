import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Code, Callout } from "@/components/docs/prose";

export const metadata = {
  title: "Terms of Service — Furlpay Legal",
  description: "The Terms of Service governing access to the Furlpay web and desktop applications.",
};

export default function TermsPage() {
  return (
    <article>
      <DocTitle eyebrow="Legal">Terms of Service</DocTitle>
      <p className="mb-6 text-[13px] text-textMuted">Last updated: July 2, 2026</p>
      <Lead>
        These Terms of Service govern your access to and use of the Furlpay web and desktop applications.
        By creating an account, you agree to these terms.
      </Lead>

      <H2 id="scope">1. Scope of service</H2>
      <P>
        Furlpay provides a self-custodial MPC wallet dashboard, a card control panel, and an investment
        routing interface. Furlpay is a technology platform; it is not a bank, broker-dealer, investment
        adviser, or money transmitter. Regulated services are delivered by the licensed partners named in
        our <Link href="/legal/disclosures" className="text-neon hover:underline">Regulatory Disclosures</Link>.
      </P>

      <H2 id="no-advice">2. No financial advice</H2>
      <P>
        Furlpay does not provide investment, tax or legal advice. All trading and allocation decisions are
        self-directed. Nothing in the app constitutes a recommendation to buy, sell or hold any asset.
      </P>

      <H2 id="self-custody">3. Custody and signing</H2>
      <P>
        Furlpay operates two signing paths with <b>different custody models</b>, and which applies
        depends on the client you use.
      </P>
      <P>
        <b>Mobile app — self-custodial.</b> Your key is generated on your device and held in
        biometric-gated secure storage. It is never transmitted to Furlpay, and Furlpay cannot
        reconstruct it or move those funds.
      </P>
      <P>
        <b>Web app — custodial.</b> Signing is performed by a policy-gated secure enclave operated by
        our signing provider, which returns a complete signature; your device does not hold a key
        share. Parties holding the provider credential can, subject to enclave policy, produce
        signatures for wallets in that organisation. Authorisation is independently gated in three
        places (client, Furlpay server, enclave policy), but that is a control on <i>what</i> may be
        signed, not a split of the key itself.
      </P>
      <P>
        Full detail, including what would be required for true threshold signing, is published in our
        custody disclosure.
      </P>
      <Callout title="Loss of access">
        Loss of access to your biometric credentials and all configured recovery methods may result in the
        permanent loss of on-chain funds. Keep at least one recovery method current.
      </Callout>

      <H2 id="prohibited">4. Prohibited uses</H2>
      <P>Furlpay explicitly prohibits use of the platform for:</P>
      <UL>
        <LI>Money laundering or terrorist financing.</LI>
        <LI>Sanctions evasion or transactions with sanctioned persons or jurisdictions.</LI>
        <LI>
          Unauthorized automated trading bots operating outside of the authorized <Code>x402</Code> agent
          SDK and its spend controls.
        </LI>
      </UL>
      <P>
        We may suspend or terminate accounts that violate these terms or that our risk and compliance
        systems flag as high-risk.
      </P>

      <div className="mt-12 border-t border-white/5 pt-6 text-[13px] text-textMuted">
        Continue to our{" "}
        <Link href="/legal/privacy" className="text-neon hover:underline">Privacy Policy</Link> and{" "}
        <Link href="/legal/disclosures" className="text-neon hover:underline">Regulatory Disclosures</Link>.
      </div>
    </article>
  );
}
