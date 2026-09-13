import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";
import { Hero, FeatureGrid, Section, CtaBand } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import { financialProduct, breadcrumb, SITE } from "@/lib/seo/schema";

const URL = `${SITE}/products/wallet`;

export const metadata: Metadata = {
  title: "Passkey Wallet — Phishing-Resistant Signing",
  description:
    "A passkey-secured wallet: phishing-resistant authentication, policy-gated signing, gasless USDC on Arbitrum, and an honest account of what custody you actually have.",
  alternates: { canonical: "/products/wallet" },
  openGraph: { type: "website", url: URL, title: "Passkey Wallet — No Seed Phrase" },
};

const FEATURES = [
  { title: "No seed phrase on web", body: "The web wallet has no twelve-word phrase to write down or have phished, because signing runs through a policy-gated enclave rather than a key you store. The trade-off is that this path is custodial — the mobile app is where you hold your own key." },
  { title: "Phishing-resistant", body: "Passkeys are bound to the origin, so a fake site cannot trick you into signing. WebAuthn under the hood." },
  { title: "Three-layer signing policy", body: "A signature request must clear the client, our server, and the enclave's own policy. Each can refuse independently." },
  { title: "Gasless USDC", body: "A paymaster sponsors gas on Arbitrum, so you send USDC without holding ETH for fees." },
  { title: "Real recovery", body: "Recover access through your passkey providers instead of a fragile seed backup." },
  { title: "One account", body: "The same wallet powers payments, travel, and investing — not a separate app to manage." },
];

const FAQ = [
  {
    q: "How does a passkey wallet work without a seed phrase?",
    a: "Passkeys (WebAuthn) authorise actions and are phishing-resistant because they are bound to this site's origin. Signing itself differs by client: the mobile app holds your key on your device, while the web app signs through a policy-gated secure enclave operated by our provider, which is custodial. We publish that distinction rather than blur it.",
  },
  {
    q: "Is a passkey wallet safe if I lose my phone?",
    a: "On the web, yes — passkeys sync through your provider (e.g. iCloud Keychain or Google), so you can regain access on a new device without a written backup. On the mobile app your key lives on the device, so losing it without your backup means the funds are unrecoverable.",
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
            description: "Passkey-secured wallet with policy-gated signing and gasless USDC on Arbitrum.",
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
          subtitle="Passkey-secured, phishing-resistant, and policy-gated at three independent layers. Send gasless USDC on Arbitrum — and read exactly which custody model applies to which client."
          secondary={{ href: "/docs/security/mpc-webauthn", label: "How it works" }}
        />

        <p className="mt-8 max-w-2xl rounded-xl border border-white/10 bg-white/[0.02] p-5 text-[15px] leading-relaxed text-textSecondary">
          Furlpay&apos;s wallet replaces the seed phrase with <strong className="text-white">passkeys</strong>{" "}
          and <strong className="text-white">policy-gated signing</strong> — so authorisation is bound to
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
