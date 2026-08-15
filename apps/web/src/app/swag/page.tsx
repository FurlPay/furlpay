import type { Metadata } from "next";
import Link from "next/link";
import { GitPullRequest, Coins, Gift, Star } from "lucide-react";
import LandingChrome from "@/components/landing/LandingChrome";
import { Hero, Section, CtaBand } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";
import { REWARD_TIERS, BONUS_RULES } from "@/lib/swag";
import SwagStore from "@/components/marketing/SwagStore";

export const metadata: Metadata = {
  title: "FurlPay Swag Center — Earn Contributor Merch with Points",
  description:
    "The FurlPay Swag Center: hoodies, tees and stickers you earn with open-source contribution points and redeem for free. Tiered rewards for builders on x402 and Arbitrum.",
  alternates: { canonical: "/swag" },
  openGraph: { type: "website", title: "FurlPay Swag Center", description: "Earn contributor swag with points." },
};

const STEPS = [
  { Icon: GitPullRequest, title: "1 · Contribute", body: "Open a PR on any FurlPay repo — code, docs, design or a security report all count." },
  { Icon: Coins, title: "2 · Earn points", body: "Merged contributions post points to your account, scaled to impact." },
  { Icon: Gift, title: "3 · Redeem", body: "Spend points in the store below, add your shipping address, and we ship it to you." },
];

const POLICIES: { title: string; body: string }[] = [
  { title: "Eligibility", body: "Open to anyone who has contributed to a FurlPay open-source repository. One person may hold one points balance; balances are personal and non-transferable." },
  { title: "How points are earned", body: "Points post after a pull request is merged, based on the earn-rate table above. Non-code contributions (design, docs, translations, community support) count too. Contributions are reviewed monthly." },
  { title: "Redemption", body: "Redeeming places a request — it does not deduct points instantly. We verify your points against your merged contributions, then confirm. If your balance is short, we'll tell you how many more points you need. Points have no cash value and can't be exchanged for money." },
  { title: "Shipping & fulfillment", body: "Swag is produced on demand and shipped globally. To keep logistics lean, orders are batched and produced close to you — allow up to a few weeks for delivery. We cover standard shipping; any local import duties are the recipient's responsibility." },
  { title: "Data & privacy", body: "Your email and shipping address are used solely to verify your redemption and deliver your swag, and are shared only with our fulfillment provider for that purpose. They are never sold. See our privacy policy for details." },
  { title: "Fairness & changes", body: "We may adjust point values, catalog and rules over time, and may decline redemptions tied to spam, plagiarised, or bad-faith contributions. Rewards are granted at Furlpay's discretion." },
];

const FAQ = [
  { q: "How do I earn swag points?", a: "Open a pull request on a FurlPay repository. When it's merged, points post to your account based on impact — from 10 points for docs to 200+ for features and security work. Non-code contributions like design, docs and translations count too." },
  { q: "How does redeeming work — is anything charged?", a: "Nothing is charged. You redeem with points only. Checkout records a redemption request and emails it to hello@furlpay.com with your shipping details; we verify your points, confirm, and ship your swag. Points are only deducted once we confirm the order." },
  { q: "How many points does each item cost?", a: "Points are scaled to each item's worth: a sticker pack is 10 points, a tee is 60, and a hoodie is 200. Each product card shows its point cost and approximate retail worth." },
  { q: "Do you ship internationally?", a: "Yes — fulfilment is print-on-demand with global providers. Orders are batched and produced close to you to keep logistics lean, so allow a couple of weeks for delivery." },
  { q: "What happens to my address and email?", a: "They're used only to verify your redemption and ship your swag, shared only with our fulfilment provider for delivery, and never sold. You can ask us to delete them after your order ships." },
];

export default function SwagPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Swag Center", path: "/swag" },
        ])}
      />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-14">
        <Hero
          eyebrow="FurlPay Swag Center"
          title={<>Build with us. Wear the proof.</>}
          subtitle="Earn hoodies, tees and stickers with open-source contribution points, then redeem them for free — we ship to your door. A reward store for the builders shipping the agentic-payments future on Arbitrum."
          primary={{ href: "#store", label: "Shop the store" }}
          secondary={{ href: "/hackathon", label: "Build Challenge" }}
        />

        {/* How it works */}
        <Section title="How it works">
          <div className="grid gap-5 sm:grid-cols-3">
            {STEPS.map(({ Icon, title, body }) => (
              <div key={title} className="glass-card p-6">
                <Icon className="h-6 w-6 text-neon" />
                <h3 className="mt-3 text-[16px] font-bold">{title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-textSecondary">{body}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Store */}
        <Section title="The store">
          <div id="store" className="scroll-mt-24">
            <SwagStore />
          </div>
        </Section>

        {/* Reward tiers / earn rate */}
        <Section title="Earn rate">
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-left text-[14px]">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.03]">
                  <th className="px-5 py-4 font-semibold text-textSecondary">Contribution</th>
                  <th className="px-5 py-4 font-bold text-neon">Points</th>
                  <th className="px-5 py-4 font-semibold text-textSecondary">What it looks like</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {REWARD_TIERS.map((t) => (
                  <tr key={t.label} className="transition-colors hover:bg-white/[0.02]">
                    <td className="px-5 py-4 font-medium">{t.label}</td>
                    <td className="px-5 py-4 font-semibold text-neon">{t.points}</td>
                    <td className="px-5 py-4 text-textSecondary">{t.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-5 grid gap-2 sm:grid-cols-2">
            {BONUS_RULES.map((r) => (
              <li key={r} className="flex items-start gap-2 text-[13px] text-textSecondary">
                <Star className="mt-0.5 h-4 w-4 shrink-0 text-neon" /> {r}
              </li>
            ))}
          </ul>
        </Section>

        {/* Rules & policies */}
        <Section title="Rules & policies">
          <div className="grid gap-4 sm:grid-cols-2">
            {POLICIES.map((p) => (
              <div key={p.title} className="glass-card p-5">
                <h3 className="text-[15px] font-bold">{p.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-textSecondary">{p.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[13px] text-textMuted">
            Full contribution criteria live in{" "}
            <Link href="https://github.com/Ashutosh0x/furlpay/blob/main/CONTRIBUTING.md" className="text-neon hover:underline">CONTRIBUTING.md</Link>.
            Questions about a redemption? Email{" "}
            <a href="mailto:hello@furlpay.com" className="text-neon hover:underline">hello@furlpay.com</a>. See also our{" "}
            <Link href="/legal/privacy" className="text-neon hover:underline">privacy policy</Link>.
          </p>
        </Section>

        <FaqSection items={FAQ} title="Swag Center FAQ" />

        <CtaBand
          title="Ship code, earn the hoodie"
          subtitle="Open your first PR, rack up points, and redeem your swag."
          primary={{ href: "#store", label: "Shop the store" }}
          secondary={{ href: "/developer", label: "Start contributing" }}
        />

        <p className="mt-10 text-center text-[11px] leading-relaxed text-textMuted">
          Swag is redeemed with contribution points; no payment is taken on this page. Redemption
          places a request that we verify and fulfil via print-on-demand — allow a couple of weeks
          for delivery. Point values and catalog may change. Rewards are granted at Furlpay&apos;s discretion.
        </p>
      </main>
    </div>
  );
}
