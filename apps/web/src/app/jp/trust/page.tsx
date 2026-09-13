import type { Metadata } from "next";
import Link from "next/link";
import LandingChrome from "@/components/landing/LandingChrome";
import { Hero, Section } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";
import { altLanguages } from "@/lib/seo/hreflang";

export const metadata: Metadata = {
  title: "Japan Trust, Risk & JFSA Status",
  description:
    "Furlpay's Japan regulatory status, crypto-asset risk information, and security posture. Honest status: not registered with the JFSA — USDC is a legal Electronic Payment Instrument distributed via registered intermediaries.",
  alternates: {
    canonical: "/jp/trust",
    languages: altLanguages({ us: "/trust", uk: "/uk/trust", ae: "/ae/trust", jp: "/jp/trust" }),
  },
};

const FAQ = [
  { q: "Is Furlpay registered with Japan's FSA?", a: "No. Furlpay is not registered with the Financial Services Agency (JFSA) as a Crypto-Asset Exchange Service Provider or an Electronic Payment Instrument Exchange Service Provider (EPIESP). Both registrations require a local presence and are how stablecoins are distributed and intermediated in Japan. Furlpay is evaluating a licensed-intermediary pathway and states its status honestly." },
  { q: "Is USDC legal in Japan?", a: "Yes. Since 1 June 2026 USDC is recognised under Japanese law as an Electronic Payment Instrument, distributed by JFSA-registered providers such as SBI VC Trade. That gives businesses legal clarity to accept it — through a compliant intermediary pathway rather than a grey area." },
  { q: "Are my crypto assets protected?", a: "Crypto assets are high risk. They are not legal tender, not bank deposits, and not covered by deposit-insurance schemes. Their value can fall as well as rise, and you may lose all the money you put in." },
  { q: "How does Furlpay keep funds secure?", a: "Furlpay uses passkey (WebAuthn) authentication and a three-layer signing policy. Custody depends on the client, and we say which is which: the mobile app holds your key on your device (self-custodial), while web signing runs through a policy-gated secure enclave operated by our provider (custodial). Payments are screened against sanctions lists, and core code is open-source and auditable." },
];

export default function JpTrustPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Japan", path: "/jp" },
          { name: "Trust & JFSA", path: "/jp/trust" },
        ])}
      />
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-14">
        <Hero
          eyebrow="Japan · Trust, risk & JFSA"
          title="Honest about risk and regulation."
          subtitle="Crypto assets are high risk and Furlpay is not registered with the JFSA. Here is exactly where we stand, what the risks are, and how we protect you."
          primary={{ href: "/talk-to-us", label: "Talk to us" }}
          secondary={{ href: "/trust", label: "Global trust centre" }}
        />

        {/* Prominent risk warning */}
        <aside role="note" className="mt-8 rounded-xl border border-yellow-400/30 bg-yellow-400/[0.07] p-5 text-[14px] leading-relaxed text-yellow-100/90">
          <strong>Crypto assets are high risk and are not legal tender.</strong> Their value can fall
          as well as rise and you could lose all the money you put in. This page is information, not
          financial advice.
        </aside>

        <Section title="Our JFSA status (as of July 2026)">
          <div className="glass-card p-6 text-[14px] leading-relaxed text-textSecondary">
            <p>
              Furlpay is <strong className="text-white">not registered with Japan&apos;s Financial
              Services Agency (JFSA)</strong> as a Crypto-Asset Exchange Service Provider or an
              Electronic Payment Instrument Exchange Service Provider (EPIESP). USDC itself is a{" "}
              <strong className="text-white">legal Electronic Payment Instrument</strong> in Japan as
              of 1 June 2026, distributed through registered intermediaries such as SBI VC Trade. We
              are evaluating a licensed-intermediary pathway and will update this page as our status
              changes.
            </p>
            <p className="mt-3">
              We do not overstate our position. If a claim about registration or licensing is not on
              this page, we have not made it.
            </p>
          </div>
        </Section>

        <Section title="Key risks you should understand">
          <ul className="space-y-3 text-[14px] leading-relaxed text-textSecondary">
            {[
              "You could lose all the money you put in. Crypto-asset values can fall sharply and without warning.",
              "Crypto assets are not legal tender in Japan and are not bank deposits or covered by deposit insurance.",
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
              { t: "Passkey auth + policy-gated signing", b: "WebAuthn passkeys, phishing-resistant by origin binding, and three independent policy gates before anything is signed." },
              { t: "Sanctions screening", b: "Both sides of every payment are screened before settlement." },
              { t: "95% principle & segregation", b: "Custody is designed around cold-storage-first and asset segregation, the controls Japanese regulation expects." },
              { t: "Open source", b: "Core SDKs, CLI and the x402 facilitator are MIT-licensed and independently auditable." },
            ].map((c) => (
              <div key={c.t} className="glass-card p-5">
                <h3 className="text-[15px] font-bold">{c.t}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-textSecondary">{c.b}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-[13px]">
            <Link href="/trust" className="rounded-full border border-white/10 px-4 py-2 hover:border-neon/30 hover:text-neon">Global trust centre</Link>
            <Link href="/legal/privacy" className="rounded-full border border-white/10 px-4 py-2 hover:border-neon/30 hover:text-neon">Privacy (APPI-aware)</Link>
            <Link href="/legal/risk-disclosure" className="rounded-full border border-white/10 px-4 py-2 hover:border-neon/30 hover:text-neon">Risk disclosure</Link>
            <Link href="/legal/responsible-disclosure" className="rounded-full border border-white/10 px-4 py-2 hover:border-neon/30 hover:text-neon">Responsible disclosure</Link>
          </div>
        </Section>

        <FaqSection items={FAQ} title="Japan questions" />

        <p className="mt-10 text-[11px] leading-relaxed text-textMuted">
          Furlpay is not a bank and is not registered with the JFSA. Crypto assets are high risk, are
          not legal tender, and can lose value. This page is information, not financial advice. Status
          accurate as of July 2026.
        </p>
      </main>
    </div>
  );
}
