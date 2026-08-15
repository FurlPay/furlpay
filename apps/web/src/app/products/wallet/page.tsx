import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";
import { Hero, FeatureGrid, Section, CtaBand } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import { financialProduct, breadcrumb, SITE } from "@/lib/seo/schema";

const URL = `${SITE}/products/wallet`;

export const metadata: Metadata = {
  title: "Passkey Wallet — No Seed Phrase, Phishing-Resistant MPC",
  description:
    "A passkey-secured MPC wallet with no seed phrase to lose or leak. Phishing-resistant, 2-of-2 key custody, gasless USDC on Arbitrum, and account recovery that actually works.",
  alternates: { canonical: "/products/wallet" },
  openGraph: { type: "website", url: URL, title: "Passkey Wallet — No Seed Phrase" },
};

const FEATURES = [
  { title: "No seed phrase", body: "Keys are generated with MPC — there is no twelve-word phrase to write down, lose, or have phished." },
  { title: "Phishing-resistant", body: "Passkeys are bound to the origin, so a fake site cannot trick you into signing. WebAuthn under the hood." },
  { title: "2-of-2 MPC custody", body: "The signing key is split so neither Furlpay nor a single device can move funds alone." },
  { title: "Gasless USDC", body: "A paymaster sponsors gas on Arbitrum, so you send USDC without holding ETH for fees." },
  { title: "Real recovery", body: "Recover access through your passkey providers instead of a fragile seed backup." },
  { title: "One account", body: "The same wallet powers payments, travel, and investing — not a separate app to manage." },
];

const FAQ = [
  {
    q: "How does a passkey wallet work without a seed phrase?",
    a: "Furlpay uses multi-party computation (MPC) to split the signing key across parties, and passkeys (WebAuthn) to authorize actions. There is no single seed phrase — authorization is bound to your device's passkey, which is phishing-resistant.",
  },
  {
    q: "Is a passkey wallet safe if I lose my phone?",
    a: "Yes. Because keys use 2-of-2 MPC and passkeys sync through your provider (e.g. iCloud Keychain or Google), you can recover access on a new device without a written seed backup, and a lost device alone cannot move funds.",
  },
  {
    q: "Do I need ETH to pay gas?",
    a: "No. A paymaster sponsors Arbitrum gas, so you can send USDC without holding ETH. Gas on Arbitrum is a fraction of a cent regardless.",
  },
];

export default function WalletPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={[
          financialProduct({
            name: "Furlpay Wallet",
            description: "Passkey-secured MPC wallet with no seed phrase and gasless USDC on Arbitrum.",
            url: URL,
            serviceUrl: `${SITE}/docs/security/mpc-webauthn`,
            category: "Crypto wallet",
          }),
          breadcrumb([
            { name: "Home", path: "/" },
            { name: "Products", path: "/products" },
            { name: "Wallet", path: "/products/wallet" },
          ]),
        ]}
      />
      <main className="section pb-24 pt-14">
        <Hero
          eyebrow="Wallet"
          title="A wallet with no seed phrase to lose."
          subtitle="Passkey-secured, phishing-resistant, and backed by 2-of-2 MPC custody. Send gasless USDC on Arbitrum and recover access without a fragile twelve-word backup."
          secondary={{ href: "/docs/security/mpc-webauthn", label: "How it works" }}
        />

        <p className="mt-8 max-w-2xl rounded-xl border border-white/10 bg-white/[0.02] p-5 text-[15px] leading-relaxed text-textSecondary">
          Furlpay&apos;s wallet replaces the seed phrase with <strong className="text-white">passkeys</strong>{" "}
          and <strong className="text-white">2-of-2 MPC</strong> key custody — so signing is bound to
          your device and phishing-resistant, and a single lost device cannot move your funds.
        </p>

        <Section title="Security that gets out of your way">
          <FeatureGrid items={FEATURES} />
        </Section>

        <FaqSection items={FAQ} />

        <CtaBand
          title="Own crypto without the footguns"
          subtitle="Passkey security, gasless USDC, real recovery."
          secondary={{ href: "/trust", label: "Trust center" }}
        />
      </main>
    </div>
  );
}
