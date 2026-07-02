import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Code, Callout } from "@/components/docs/prose";

export const metadata = {
  title: "AML / KYC Policy — Furlpay Legal",
  description: "Furlpay's anti-money-laundering, know-your-customer, sanctions screening and Travel Rule approach.",
};

export default function AmlKycPage() {
  return (
    <article>
      <DocTitle eyebrow="Legal">AML / KYC Policy</DocTitle>
      <p className="mb-6 text-[13px] text-textMuted">Last updated: July 2, 2026</p>
      <Lead>
        Furlpay operates a risk-based anti-money-laundering (AML) and counter-terrorist-financing (CTF)
        program. Identity verification, sanctions screening and transaction monitoring are built into the
        product, not bolted on.
      </Lead>

      <H2 id="cdd">1. Customer Due Diligence (KYC)</H2>
      <P>
        Before accessing regulated features, customers complete identity verification through our KYC
        partner <Code>Persona</Code> — government ID capture, selfie match and liveness (PAD) checks.
        Verification is tiered: higher limits and features require higher assurance.
      </P>
      <UL>
        <LI>Tier 0 — email / phone only, minimal functionality.</LI>
        <LI>Tier 1–2 — ID + liveness, standard limits.</LI>
        <LI>Tier 3 — enhanced due diligence for higher limits and business accounts.</LI>
      </UL>

      <H2 id="sanctions">2. Sanctions & PEP screening</H2>
      <P>
        Customers and, where applicable, counterparties are screened against sanctions lists (e.g. OFAC, EU,
        UN) and politically-exposed-person (PEP) and adverse-media data. Wallet addresses are screened for
        AML risk before high-value transfers via our chain-analytics seam.
      </P>

      <H2 id="monitoring">3. Transaction monitoring</H2>
      <UL>
        <LI>Real-time device and behavioural risk scoring gates transfers.</LI>
        <LI>Rules flag structuring, velocity anomalies and high-risk counterparties.</LI>
        <LI>Step-up verification is required for high-value or sensitive actions.</LI>
      </UL>

      <H2 id="travel-rule">4. FATF Travel Rule</H2>
      <P>
        For qualifying VASP-to-VASP transfers above the reporting threshold, required originator and
        beneficiary information is exchanged in line with the FATF Travel Rule. See{" "}
        <Link href="/docs/compliance/mica" className="text-neon hover:underline">the compliance docs</Link>.
      </P>

      <H2 id="reporting">5. Suspicious activity & record-keeping</H2>
      <P>
        Suspicious activity is escalated to the relevant authorities where required, and records are
        retained in line with applicable law. Accounts may be frozen or closed where legally required or
        where risk thresholds are exceeded.
      </P>

      <Callout title="Regulatory scope">
        Furlpay is a technology platform; regulated activities are performed by licensed partners in each
        market. This policy is a summary of program principles and is reviewed as Furlpay obtains licenses
        (e.g. MiCA CASP, FinCEN MSB) per jurisdiction.
      </Callout>

      <div className="mt-12 border-t border-white/5 pt-6 text-[13px] text-textMuted">
        Contact our compliance team at{" "}
        <a href="mailto:hello@furlpay.com" className="text-neon hover:underline">hello@furlpay.com</a>.
      </div>
    </article>
  );
}
