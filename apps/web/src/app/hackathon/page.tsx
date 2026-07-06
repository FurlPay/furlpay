import type { Metadata } from "next";
import Link from "next/link";
import { Hammer, Send, Trophy, Rocket, Coins, Radio } from "lucide-react";
import MarketingBar from "@/components/marketing/MarketingBar";
import { Hero, Section, FeatureGrid, CtaBand } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";
import { TRACKS, IDEAS } from "@/lib/hackathon";
import HackathonForm from "@/components/marketing/HackathonForm";
import HackathonGallery from "@/components/marketing/HackathonGallery";
import HackathonCountdown from "@/components/marketing/HackathonCountdown";

export const metadata: Metadata = {
  title: "FurlPay Build Challenge — Hackathon for x402 & Arbitrum Builders",
  description:
    "Build on FurlPay: x402 agentic payments, stablecoin checkout, and travel rails on Arbitrum. Submit your project or idea, get featured, and win USDC prizes + developer-program access. Rolling submissions.",
  alternates: { canonical: "/hackathon" },
  openGraph: { type: "website", title: "FurlPay Build Challenge", description: "Ship on x402 + Arbitrum. Submit your build." },
};

const STEPS = [
  { Icon: Hammer, title: "1 · Build", body: "Use FurlPay's SDKs, x402 facilitator and Arbitrum rails. An idea-stage submission is welcome too." },
  { Icon: Send, title: "2 · Submit", body: "Pick a track and submit your project below — repo and demo links optional but encouraged." },
  { Icon: Trophy, title: "3 · Get featured", body: "We review on a rolling basis and spotlight standout builds on furlpay.com, X and YouTube." },
];

const PERKS = [
  { Icon: Coins, title: "USDC prizes", body: "A USDC prize pool each season for the strongest builds across all four tracks." },
  { Icon: Rocket, title: "Developer fast-track", body: "Priority access to the FurlPay developer program, API credits and grant-partner intros." },
  { Icon: Radio, title: "Reach", body: "Winning and featured projects get amplified to our whole audience across furlpay.com and socials." },
];

const FAQ = [
  { q: "Who can enter the FurlPay Build Challenge?", a: "Anyone — solo builders, teams, students and startups. You can submit a finished build or an idea you plan to ship. There is no entry fee." },
  { q: "What should I build?", a: "Anything on FurlPay's rails: x402 agentic payments, stablecoin checkout, travel/booking flows, or developer tooling on Arbitrum. Pick the track that fits and use the idea prompts on this page for inspiration." },
  { q: "Do I need a working demo to submit?", a: "No. Repo and demo links are optional. A clear one-liner and description are enough to enter; working builds are more likely to be featured and win." },
  { q: "How are winners chosen and what do you get?", a: "We review submissions on a rolling basis for originality, use of FurlPay/x402, and craft. Featured and winning builds receive USDC prizes, developer-program access with API credits, and a feature across furlpay.com and our socials." },
  { q: "Who owns my project?", a: "You do. Submitting keeps full ownership of your code and IP with you — we only ask permission to feature it publicly." },
];

export default function HackathonPage() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Build Challenge", path: "/hackathon" },
        ])}
      />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-14">
        <Hero
          eyebrow="FurlPay Build Challenge · Season 1"
          title={<>Ship on x402 &amp; Arbitrum. Get funded, featured, and fast-tracked.</>}
          subtitle="Build the agentic payments future on FurlPay's rails — AI-agent payments, stablecoin checkout, travel and dev tooling. Submit a finished build or just an idea. Rolling submissions, USDC prizes, and a feature to our whole audience."
          primary={{ href: "#submit", label: "Submit your project" }}
          secondary={{ href: "#gallery", label: "See the builds" }}
        />

        <div className="mt-10 max-w-xl">
          <HackathonCountdown />
        </div>

        {/* Tracks */}
        <Section title="Four tracks">
          <FeatureGrid items={TRACKS.map((t) => ({ title: t.label, body: t.blurb }))} />
        </Section>

        {/* Ideas to build */}
        <Section title="Not sure what to build? Start here">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {IDEAS.map((idea, i) => (
              <div key={i} className="glass-card p-5">
                <p className="text-[12px] font-semibold text-neon">Idea {String(i + 1).padStart(2, "0")}</p>
                <p className="mt-1.5 text-[14px] leading-relaxed text-textSecondary">{idea}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[13px] text-textMuted">
            New to the stack? Start at the{" "}
            <Link href="/developer" className="text-neon hover:underline">developer portal</Link>,{" "}
            <Link href="/docs" className="text-neon hover:underline">docs</Link>, and the{" "}
            <Link href="/api/x402/discovery/resources" className="text-neon hover:underline">x402 resource catalog</Link>.
          </p>
        </Section>

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

        {/* Perks / prizes */}
        <Section title="What you get">
          <div className="grid gap-5 sm:grid-cols-3">
            {PERKS.map(({ Icon, title, body }) => (
              <div key={title} className="glass-card p-6">
                <Icon className="h-6 w-6 text-neon" />
                <h3 className="mt-3 text-[16px] font-bold">{title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-textSecondary">{body}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Submit */}
        <Section title="Submit your project">
          <div id="submit" className="scroll-mt-24 rounded-2xl border border-white/10 bg-white/[0.02] p-6 sm:p-8">
            <HackathonForm />
          </div>
        </Section>

        {/* Gallery */}
        <Section title="Submitted builds">
          <div id="gallery" className="scroll-mt-24">
            <HackathonGallery />
          </div>
        </Section>

        <FaqSection items={FAQ} title="Build Challenge FAQ" />

        <CtaBand
          title="Got a build in you?"
          subtitle="Submit a project or an idea — it takes two minutes."
          primary={{ href: "#submit", label: "Submit your project" }}
          secondary={{ href: "/developer", label: "Developer portal" }}
        />

        <p className="mt-10 text-center text-[11px] leading-relaxed text-textMuted">
          Submissions are reviewed on a rolling basis. Prizes and perks are awarded at Furlpay&apos;s
          discretion per season. You retain full ownership of your code and IP. Crypto assets are high
          risk and can lose value.
        </p>
      </main>
    </div>
  );
}
