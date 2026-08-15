import type { Metadata } from "next";
import Link from "next/link";
import MarketingBar from "@/components/marketing/MarketingBar";
import { Hero, Section } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "Trust & Security Center — How Furlpay Protects You",
  description:
    "Furlpay's approach to security and compliance: passkey (WebAuthn) auth, 2-of-2 MPC custody, sanctions screening, Travel Rule support, MiCA-aware design, and open-source code.",
  alternates: {
    canonical: "/trust",
    languages: { "en-US": "/trust", "en-GB": "/uk/trust", "en-AE": "/ae/trust", "en-JP": "/jp/trust", "x-default": "/trust" },
  },
};

const PILLARS = [
  { title: "Passkey authentication", body: "Sign-in and signing use WebAuthn passkeys bound to the site origin — phishing-resistant by design, with no password to steal.", href: "/docs/security/mpc-webauthn" },
  { title: "2-of-2 MPC custody", body: "The signing key is split via multi-party computation, so no single device or party can move funds alone. No seed phrase exists to leak.", href: "/docs/security/mpc-webauthn" },
  { title: "Sanctions screening", body: "Both sides of every payment are screened against sanctions lists before settlement.", href: "/legal/aml-kyc" },
  { title: "Travel Rule support", body: "Originator/beneficiary data is supported for transfers that require it under FATF guidance.", href: "/legal/travel-rule" },
  { title: "MiCA-aware design", body: "EURC auto-swap and jurisdiction handling are built for EU compliance under MiCA.", href: "/docs/compliance/mica" },
  { title: "Open source", body: "SDKs, CLI, MCP server, extension, and x402 facilitator are MIT-licensed on GitHub — auditable by anyone.", href: "https://github.com/Ashutosh0x/furlpay" },
];

const FAQ = [
  {
    q: "How does Furlpay keep my funds secure?",
    a: "Furlpay uses passkey (WebAuthn) authentication and 2-of-2 MPC custody, so signing is phishing-resistant and no single device or party can move funds alone. There is no seed phrase to lose or leak, and account recovery works through your passkey providers.",
  },
  {
    q: "Is Furlpay open source?",
    a: "Yes. The SDKs, CLI, MCP server, browser extension, and x402 facilitator are MIT-licensed on GitHub, so the code can be independently audited, forked, and self-hosted.",
  },
  {
    q: "How do I report a security vulnerability?",
    a: "Follow the responsible-disclosure policy at /legal/responsible-disclosure. It explains scope, how to submit a report, and what to expect after disclosure.",
  },
  {
    q: "How does Furlpay handle compliance?",
    a: "Payments are screened against sanctions lists, Travel Rule information is supported where required, and the platform is designed for MiCA in the EU (including EURC auto-swap). See the compliance and legal sections for specifics by jurisdiction.",
  },
];

export default function TrustPage() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Trust", path: "/trust" },
        ])}
      />
      {/* max-w-6xl px-6 — matched to MarketingBar deliberately. The bar is
          max-w-6xl and this was max-w-5xl, so the content sat 128px narrower
          than the header above it and the logo overhung the page by 64px a
          side. Same container, same padding, one edge. */}
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-14">
        <Hero
          eyebrow="Trust & security"
          title="Security you can audit."
          subtitle="Fintech is Your-Money-Your-Life territory, so we build for it: passkey auth, MPC custody, sanctions screening, and open-source code you can read yourself."
          primary={{ href: "/legal/responsible-disclosure", label: "Report a vulnerability" }}
          secondary={{ href: "/docs/security/mpc-webauthn", label: "Security docs" }}
        />

        <Section title="How we protect you">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((p) => (
              <Link key={p.title} href={p.href} className="glass-card p-6 transition-colors hover:border-neon/30">
                <h3 className="text-[16px] font-bold">{p.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">{p.body}</p>
                <span className="mt-3 inline-block text-[13px] text-neon">Learn more →</span>
              </Link>
            ))}
          </div>
        </Section>

        <Section title="Compliance status">
          <p className="mb-5 max-w-2xl text-[14px] leading-relaxed text-textSecondary">
            We publish where we actually are — not aspirational badges. Controls marked live run in
            production today; formal certifications on the roadmap are dated as they progress.
          </p>
          <div className="divide-y divide-white/[0.06] rounded-2xl border border-white/10">
            {[
              { item: "Sanctions screening on every payment", status: "Live" },
              { item: "Travel Rule information support", status: "Live" },
              { item: "MiCA-aligned design (EURC auto-swap, jurisdiction handling)", status: "Live" },
              { item: "Passkey (WebAuthn) auth + 2-of-2 MPC custody", status: "Live" },
              { item: "GDPR alignment (privacy policy, DPA, subprocessors)", status: "Live" },
              { item: "Responsible disclosure & safe harbor", status: "Live" },
              { item: "SOC 2 Type II", status: "In progress" },
              { item: "Independent penetration test", status: "Planned" },
              { item: "Smart-contract audit", status: "Planned" },
              { item: "SSO / SAML for enterprise accounts", status: "Planned" },
            ].map((row) => (
              <div key={row.item} className="flex items-center justify-between gap-4 p-4">
                <span className="text-[14px] text-textSecondary">{row.item}</span>
                <StatusPill status={row.status} />
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-textMuted">
            Status as of July 2026. Enterprise customers can request current documentation under NDA
            via <Link href="/talk-to-us" className="text-neon">sales</Link>.
          </p>
        </Section>

        <Section title="For enterprise security teams">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "Per-transaction audit trail", body: "Every payment produces a signed, Arbiscan-verifiable receipt and an immutable on-chain record for audit and reconciliation." },
              { title: "Jurisdiction & KYC controls", body: "Enforce jurisdiction blocks and KYC-tier gating per policy, applied before settlement." },
              { title: "Reconciliation exports", body: "Structured payment and settlement data (CSV / ISO 20022) for finance and ERP reconciliation." },
              { title: "Incident response", body: "Documented response process, a public status page, and disclosure via our responsible-disclosure policy." },
              { title: "Data handling", body: "Documented retention and deletion, a subprocessors list, and DPA available for enterprise contracts." },
              { title: "Open-source auditability", body: "Core SDKs, CLI, MCP server, and x402 facilitator are MIT-licensed, so your team can review the payment path directly." },
            ].map((f) => (
              <div key={f.title} className="glass-card p-6">
                <h3 className="text-[15px] font-bold">{f.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-textSecondary">{f.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Policies & disclosures">
          <div className="flex flex-wrap gap-3 text-[14px]">
            {[
              { href: "/legal/privacy", label: "Privacy Policy" },
              { href: "/legal/terms", label: "Terms" },
              { href: "/legal/aml-kyc", label: "AML / KYC" },
              { href: "/legal/travel-rule", label: "Travel Rule" },
              { href: "/legal/risk-disclosure", label: "Risk Disclosure" },
              { href: "/legal/responsible-disclosure", label: "Responsible Disclosure" },
              { href: "/legal/subprocessors", label: "Subprocessors" },
              { href: "/status", label: "System Status" },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="rounded-full border border-white/10 px-4 py-2 transition-colors hover:border-neon/30 hover:text-neon">
                {l.label}
              </Link>
            ))}
          </div>
        </Section>

        <FaqSection items={FAQ} />

        <p className="mt-10 text-center text-[11px] text-textMuted">
          Furlpay is not a bank. Crypto assets are not deposit-insured and can lose value. Specific
          compliance features vary by jurisdiction.
        </p>
      </main>
    </div>
  );
}

// Honest, colour-coded compliance status. Green = live in production,
// amber = actively in progress, muted = planned/roadmap.
function StatusPill({ status }: { status: string }) {
  const tone =
    status === "Live"
      ? "border-neon/30 bg-neon/10 text-neon"
      : status === "In progress"
        ? "border-yellow-400/30 bg-yellow-400/10 text-yellow-300"
        : "border-white/15 bg-white/5 text-textMuted";
  return (
    <span className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-semibold ${tone}`}>
      {status}
    </span>
  );
}
