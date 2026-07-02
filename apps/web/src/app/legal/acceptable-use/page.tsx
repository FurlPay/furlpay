import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI } from "@/components/docs/prose";

export const metadata = {
  title: "Acceptable Use Policy — Furlpay Legal",
  description: "Activities prohibited on Furlpay.",
};

export default function AcceptableUsePage() {
  return (
    <article>
      <DocTitle eyebrow="Legal">Acceptable Use Policy</DocTitle>
      <p className="mb-6 text-[13px] text-textMuted">Last updated: July 2, 2026</p>
      <Lead>
        You may not use Furlpay — including its APIs, SDKs, MCP server, x402 endpoints and agent tooling —
        for the activities below. Violations may result in suspension, termination and reporting to
        authorities.
      </Lead>

      <H2 id="financial-crime">1. Financial crime</H2>
      <UL>
        <LI>Money laundering or terrorist financing.</LI>
        <LI>Sanctions evasion, or transactions with sanctioned persons or jurisdictions.</LI>
        <LI>Fraud, scams, phishing, or unauthorized use of another person&apos;s funds or identity.</LI>
        <LI>Market manipulation, wash trading or insider dealing.</LI>
      </UL>

      <H2 id="prohibited-goods">2. Prohibited goods & services</H2>
      <UL>
        <LI>Illegal drugs, weapons, stolen goods, or child sexual abuse material.</LI>
        <LI>Any activity illegal in the applicable jurisdiction.</LI>
      </UL>

      <H2 id="platform-abuse">3. Platform & technical abuse</H2>
      <UL>
        <LI>Circumventing KYC, sanctions screening, spend limits or risk controls.</LI>
        <LI>Attacking, overloading, or attempting to reverse-engineer non-public systems.</LI>
        <LI>Operating automated agents outside the authorized x402/MCP controls and their spend policies.</LI>
      </UL>

      <div className="mt-12 border-t border-white/5 pt-6 text-[13px] text-textMuted">
        Report abuse to{" "}
        <a href="mailto:hello@furlpay.com" className="text-neon hover:underline">hello@furlpay.com</a>. See
        also our <Link href="/legal/terms" className="text-neon hover:underline">Terms of Service</Link>.
      </div>
    </article>
  );
}
