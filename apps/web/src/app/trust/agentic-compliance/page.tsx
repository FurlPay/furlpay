import type { Metadata } from "next";
import Link from "next/link";
import LandingChrome from "@/components/landing/LandingChrome";
import { Hero, FeatureGrid, Section } from "@/components/marketing/blocks";
import AgenticComplianceDemo from "@/components/marketing/AgenticComplianceDemo";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "Compliance-Aware Agentic Payments",
  description:
    "FurlPay enforces compliance on-chain at the point of settlement: an x402 PolicyWrapper routes agent payments through modular sanctions and source-of-funds checks, records PASS/FAIL/PENDING attestations, and resolves pending payments through escrow-mediated tranching.",
  alternates: { canonical: "/trust/agentic-compliance" },
};

const CONTRACTS = [
  { title: "X402PolicyWrapper", body: "The x402-compatible entry point. It evaluates each payment against policy before settling, so compliance is enforced at execution rather than as a separate off-chain step. The pass path is non-custodial." },
  { title: "PolicyManager", body: "An ordered set of modular compliance checks. Any FAIL blocks settlement; any PENDING requires evidence; otherwise the payment passes. Checks are pluggable and owner-managed." },
  { title: "Sanctions check", body: "Screens payer and recipient against the Chainalysis on-chain oracle and an OFAC-seeded registry. A hit fails the payment before any funds move." },
  { title: "Source-of-funds check", body: "Returns PENDING when a payment is over the threshold and the payer has no valid source-of-funds attestation on file." },
  { title: "AttestationRegistry", body: "Records a transaction-linked PASS / FAIL / PENDING attestation for every payment, plus per-address source-of-funds attestations — an inspectable, on-chain audit trail." },
  { title: "ComplianceEscrow", body: "Holds the pending tranche of a payment until a source-of-funds attestation is recorded, then releases it to the recipient. Bounded by a per-transaction cap and a refund deadline." },
];

export default function AgenticCompliancePage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Trust", path: "/trust" },
          { name: "Agentic compliance", path: "/trust/agentic-compliance" },
        ])}
      />
      <main className="section pb-24 pt-14">
        <Hero
          eyebrow="Programmable compliance"
          title="Compliance enforced on-chain, at the moment of settlement."
          subtitle="When AI agents move stablecoins autonomously, the safeguards have to hold without a human in the loop. FurlPay routes every agent payment through an on-chain guardrail that screens both sides, records an attestation, and settles only when the payment is compliant — with pending payments resolved through escrow instead of a hard decline."
          primary={{ href: "/docs/payments/agentic-x402", label: "Read the developer docs" }}
          secondary={{ href: "https://arxiv.org/abs/2605.00071", label: "Read the paper" }}
        />

        <Section title="The flow, end to end">
          <AgenticComplianceDemo />
          <p className="mt-4 text-[13px] text-textSecondary">
            This mirrors the on-chain flow exactly. A compliant payment settles in one call; a payment over the
            source-of-funds threshold is split — the compliant portion settles immediately and the remainder is held
            in escrow until the payer provides a source-of-funds attestation, at which point the escrow releases it.
            Nothing settles that would violate the policy.
          </p>
        </Section>

        <Section title="The on-chain building blocks">
          <FeatureGrid items={CONTRACTS} />
        </Section>

        <Section title="Why enforce it on-chain">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="glass-card p-6">
              <h3 className="text-[16px] font-bold">Effective without a human in the loop</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">
                Agentic payments happen at machine speed and granularity. Enforcing sanctions and source-of-funds
                checks in the settlement contract means the safeguards apply to every transfer automatically, not
                only when someone is watching.
              </p>
            </div>
            <div className="glass-card p-6">
              <h3 className="text-[16px] font-bold">Low-friction when compliant</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">
                Because checks run at the point of execution, a compliant payment settles immediately over stablecoin
                rails. Compliance stops being a separate, slow, out-of-band workflow.
              </p>
            </div>
            <div className="glass-card p-6">
              <h3 className="text-[16px] font-bold">Structured resolution, not a dead end</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">
                When a requirement is pending, the payment is not simply rejected. An initial compliant tranche
                settles and the remainder is escrowed, so the transaction can complete once evidence is provided.
              </p>
            </div>
            <div className="glass-card p-6">
              <h3 className="text-[16px] font-bold">Inspectable by design</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">
                Every payment leaves a transaction-linked attestation on-chain. Auditors and counterparties can
                verify the compliance outcome of a transfer without trusting an off-chain record.
              </p>
            </div>
          </div>
        </Section>

        <Section title="Build on it">
          <div className="glass-card flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-xl text-[14px] leading-relaxed text-textSecondary">
              The guardrail is x402-compatible, so any agent that already speaks x402 can pay through it. Evaluate a
              payment, submit a signed authorization, or read an attestation from the API.
            </p>
            <div className="flex shrink-0 gap-3">
              <Link href="/docs/payments/agentic-x402" className="btn-green px-5 py-2.5 text-[14px]">
                Developer docs
              </Link>
              <Link href="/trust" className="btn-outline px-5 py-2.5 text-[14px]">
                Trust center
              </Link>
            </div>
          </div>
        </Section>
      </main>
    </div>
  );
}
