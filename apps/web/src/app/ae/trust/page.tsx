import type { Metadata } from "next";
import Link from "next/link";
import LandingChrome from "@/components/landing/LandingChrome";
import { Hero, Section } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "UAE Trust, Risk & VARA Status",
  description:
    "Furlpay's UAE regulatory status, virtual-asset risk information, and security posture. Honest status: not currently VARA-licensed and evaluating licensing.",
  alternates: {
    canonical: "/ae/trust",
    languages: { "en-US": "/trust", "en-GB": "/uk/trust", "en-AE": "/ae/trust", "en-JP": "/jp/trust", "x-default": "/trust" },
  },
};

const FAQ = [
  { q: "Is Furlpay licensed or registered by VARA?", a: "No. Dubai's Virtual Assets Regulatory Authority (VARA) requires any entity offering virtual asset services in or from Dubai to hold a licence. Furlpay is not currently VARA-licensed and is evaluating licensing; it is not soliciting regulated virtual asset activity from UAE residents ahead of authorisation." },
  { q: "Are my virtual assets protected?", a: "Virtual assets are high risk. They are not legal tender, their value can fall as well as rise, and you could lose the money you put in. Stablecoins such as USDC carry issuer and peg risk." },
  { q: "How does Furlpay keep funds secure?", a: "Furlpay uses passkey (WebAuthn) authentication and 2-of-2 MPC custody, so there is no seed phrase and no single device can move funds alone. Payments are screened against sanctions lists, and core code is open-source and auditable." },
  { q: "What is the DDSC dirham stablecoin?", a: "DDSC is a UAE dirham-backed stablecoin approved by the Central Bank of the UAE and available on VARA-regulated platforms. It reflects the UAE's move toward regulated digital money; Furlpay settles USDC on Arbitrum and monitors UAE stablecoin developments." },
];

export default function AeTrustPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "UAE", path: "/ae" },
          { name: "Trust & VARA", path: "/ae/trust" },
        ])}
      />
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-14">
        <Hero
          eyebrow="UAE · Trust, risk & VARA"
          title="Honest about risk and regulation."
          subtitle="Virtual assets are high risk and Furlpay is not currently VARA-licensed. Here is exactly where we stand, what the risks are, and how we protect you."
          primary={{ href: "/talk-to-us", label: "Talk to us" }}
          secondary={{ href: "/trust", label: "Global trust centre" }}
        />

        <aside role="note" className="mt-8 rounded-xl border border-yellow-400/30 bg-yellow-400/[0.07] p-5 text-[14px] leading-relaxed text-yellow-100/90">
          <strong>Virtual assets are high risk.</strong> Their value can fall as well as rise and you
          could lose the money you put in. Virtual assets are not legal tender and are not bank
          deposits.
        </aside>

        <Section title="Our VARA status (as of July 2026)">
          <div className="glass-card p-6 text-[14px] leading-relaxed text-textSecondary">
            <p>
              Furlpay is <strong className="text-white">not currently licensed by the Virtual Assets
              Regulatory Authority (VARA)</strong>. Under Dubai&apos;s regime, an entity must hold a
              VARA licence before offering virtual asset activities in or from the Emirate of Dubai,
              whether to UAE residents or global customers. Furlpay is evaluating licensing and will
              update this page as our status changes.
            </p>
            <p className="mt-3">
              We do not overstate our position. If a claim about a licence or registration is not on
              this page, we have not made it.
            </p>
          </div>
        </Section>

        <Section title="Key risks you should understand">
          <ul className="space-y-3 text-[14px] leading-relaxed text-textSecondary">
            {[
              "You could lose the money you put in. Virtual asset values can fall sharply and without warning.",
              "Virtual assets are not legal tender and are not bank deposits or protected savings.",
              "Stablecoins carry issuer and peg risk. USDC is designed to track the US dollar but is not guaranteed to hold its value.",
              "Regulation is evolving. Make sure you understand what you are using and can bear the risk before you proceed.",
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
            <Link href="/legal/privacy" className="rounded-full border border-white/10 px-4 py-2 hover:border-neon/30 hover:text-neon">Privacy</Link>
            <Link href="/legal/risk-disclosure" className="rounded-full border border-white/10 px-4 py-2 hover:border-neon/30 hover:text-neon">Risk disclosure</Link>
            <Link href="/legal/responsible-disclosure" className="rounded-full border border-white/10 px-4 py-2 hover:border-neon/30 hover:text-neon">Responsible disclosure</Link>
          </div>
        </Section>

        <FaqSection items={FAQ} title="UAE questions" />

        <p className="mt-10 text-[11px] leading-relaxed text-textMuted">
          Furlpay is not a bank and is not currently licensed by VARA. Virtual assets are high risk,
          are not legal tender, and can lose value. This page is information, not financial advice.
          Status accurate as of July 2026.
        </p>
      </main>
    </div>
  );
}
