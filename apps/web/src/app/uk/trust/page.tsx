import type { Metadata } from "next";
import Link from "next/link";
import MarketingBar from "@/components/marketing/MarketingBar";
import { Hero, Section } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "UK Trust, Risk & FCA Status — Furlpay",
  description:
    "Furlpay's UK regulatory status, cryptoasset risk information, and security posture. Honest status: not yet FCA authorised — the authorisation gateway opens 30 September 2026.",
  alternates: {
    canonical: "/uk/trust",
    languages: { "en-GB": "/uk/trust", "en-US": "/trust", "en-AE": "/ae/trust", "x-default": "/trust" },
  },
};

const FAQ = [
  { q: "Is Furlpay authorised or registered by the FCA?", a: "No. The FCA cryptoasset authorisation gateway opens on 30 September 2026, firms may apply until 28 February 2027, and the new regime becomes mandatory on 25 October 2027. Furlpay is preparing for the regime and is not currently FCA authorised." },
  { q: "Are my cryptoassets protected?", a: "No. Cryptoassets are high risk. They are not regulated deposits, are not covered by the Financial Services Compensation Scheme (FSCS), and their value can fall as well as rise. You may lose all the money you put in." },
  { q: "What does the risk warning mean?", a: "UK rules require a standard warning for cryptoasset promotions: don't invest unless you're prepared to lose all the money you invest, this is a high-risk investment, and you're unlikely to be protected if something goes wrong. First-time investors also get a 24-hour cooling-off period." },
  { q: "How does Furlpay keep funds secure?", a: "Furlpay uses passkey (WebAuthn) authentication and 2-of-2 MPC custody, so there is no seed phrase and no single device can move funds alone. Payments are screened against sanctions lists, and core code is open-source and auditable." },
];

export default function UkTrustPage() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "UK", path: "/uk" },
          { name: "Trust & FCA", path: "/uk/trust" },
        ])}
      />
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-14">
        <Hero
          eyebrow="UK · Trust, risk & FCA"
          title="Honest about risk and regulation."
          subtitle="Cryptoassets are high risk and Furlpay is not yet FCA authorised. Here is exactly where we stand, what the risks are, and how we protect you."
          primary={{ href: "/talk-to-us", label: "Talk to us" }}
          secondary={{ href: "/trust", label: "Global trust centre" }}
        />

        {/* Prominent risk warning */}
        <aside role="note" className="mt-8 rounded-xl border border-yellow-400/30 bg-yellow-400/[0.07] p-5 text-[14px] leading-relaxed text-yellow-100/90">
          <strong>Don&apos;t invest unless you&apos;re prepared to lose all the money you invest.</strong>{" "}
          This is a high-risk investment and you&apos;re unlikely to be protected if something goes
          wrong.
        </aside>

        <Section title="Our FCA status (as of July 2026)">
          <div className="glass-card p-6 text-[14px] leading-relaxed text-textSecondary">
            <p>
              Furlpay is <strong className="text-white">not currently authorised or registered by
              the Financial Conduct Authority</strong>. Under the new UK cryptoasset regime, the FCA
              authorisation gateway opens on <strong className="text-white">30 September 2026</strong>,
              firms may apply until 28 February 2027, and the regime becomes mandatory on{" "}
              <strong className="text-white">25 October 2027</strong>. We are preparing for it and
              will update this page as our status changes.
            </p>
            <p className="mt-3">
              We do not overstate our position. If a claim about authorisation or registration is not
              on this page, we have not made it.
            </p>
          </div>
        </Section>

        <Section title="Key risks you should understand">
          <ul className="space-y-3 text-[14px] leading-relaxed text-textSecondary">
            {[
              "You could lose all the money you put in. Cryptoasset values can fall sharply and without warning.",
              "You are unlikely to be protected. Cryptoassets are not covered by the FSCS, and you may not have access to the Financial Ombudsman Service.",
              "Stablecoins carry issuer and peg risk. USDC is designed to track the US dollar but is not guaranteed to hold its value.",
              "Crypto is complex. Make sure you understand what you are buying and can bear the risk before you proceed.",
            ].map((r) => (
              <li key={r} className="flex items-start gap-2">
                <span className="mt-1 text-yellow-300">•</span> {r}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="How we protect you">
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { t: "Passkey + MPC custody", b: "WebAuthn passkeys and 2-of-2 MPC — no seed phrase, phishing-resistant, no single point of key compromise." },
              { t: "Sanctions screening", b: "Both sides of every payment are screened before settlement." },
              { t: "Open source", b: "Core SDKs, CLI and the x402 facilitator are MIT-licensed and independently auditable." },
              { t: "Responsible disclosure", b: "A published safe-harbour policy for reporting security issues." },
            ].map((c) => (
              <div key={c.t} className="glass-card p-5">
                <h3 className="text-[15px] font-bold">{c.t}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-textSecondary">{c.b}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-[13px]">
            <Link href="/trust" className="rounded-full border border-white/10 px-4 py-2 hover:border-neon/30 hover:text-neon">Global trust centre</Link>
            <Link href="/legal/privacy" className="rounded-full border border-white/10 px-4 py-2 hover:border-neon/30 hover:text-neon">Privacy (UK GDPR)</Link>
            <Link href="/legal/risk-disclosure" className="rounded-full border border-white/10 px-4 py-2 hover:border-neon/30 hover:text-neon">Risk disclosure</Link>
            <Link href="/legal/responsible-disclosure" className="rounded-full border border-white/10 px-4 py-2 hover:border-neon/30 hover:text-neon">Responsible disclosure</Link>
          </div>
        </Section>

        <FaqSection items={FAQ} title="UK questions" />

        <p className="mt-10 text-[11px] leading-relaxed text-textMuted">
          Furlpay is not a bank and is not currently authorised by the FCA. Cryptoassets are high
          risk, are not covered by the FSCS, and can lose value. This page is information, not
          financial advice. Status accurate as of July 2026.
        </p>
      </main>
    </div>
  );
}
