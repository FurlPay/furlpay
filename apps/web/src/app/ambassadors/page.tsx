import Link from "next/link";
import type { Metadata } from "next";
import { Zap, Globe, ShieldCheck, Coins, Store, LinkIcon, BarChart3, Users, Plane } from "lucide-react";
import MarketingBar from "@/components/marketing/MarketingBar";
import AmbassadorForm from "@/components/marketing/AmbassadorForm";
import { XIcon, InstagramIcon, YouTubeIcon, LinkedInIcon, DiscordIcon, TelegramIcon, GitHubIcon } from "@/components/marketing/SocialIcons";

export const metadata: Metadata = {
  title: "Creator Program — Earn USDC for Travel Content",
  description:
    "Turn travel content into instant USDC. The Furlpay Creator Program pays up to 10% commission, weekly, on-chain — no 60-day holds, no bank minimums. Your followers earn 2% cashback too.",
  alternates: { canonical: "/ambassadors" },
  openGraph: {
    title: "Furlpay Creator Program — Earn USDC for Travel Content",
    description:
      "Up to 10% commission, paid weekly in USDC. No holds, no minimums, on-chain transparency. Your followers earn 2% cashback.",
  },
};

const TIERS = [
  {
    name: "Explorer",
    tagline: "Start earning from day one",
    commission: "6%",
    threshold: "Any audience size",
    highlight: false,
    perks: [
      "6% commission on every booking",
      "Weekly USDC payouts, $0 minimum",
      "2% USDC cashback for your followers",
      "Personal Travel Shop storefront",
      "Real-time earnings dashboard",
    ],
  },
  {
    name: "Voyager",
    tagline: "For consistent creators",
    commission: "8%",
    threshold: "1,000+ followers or 25 bookings/mo",
    highlight: true,
    perks: [
      "8% commission — flat gross, no splits",
      "Up to $300/mo performance bonus",
      "Custom follower discount codes",
      "Priority creator support",
      "Early access to new destinations",
    ],
  },
  {
    name: "Pioneer",
    tagline: "For travel leaders",
    commission: "10%",
    threshold: "10,000+ followers or 100 bookings/mo",
    highlight: false,
    perks: [
      "10% commission — the highest in travel",
      "Up to $1,000/mo performance bonus",
      "Sponsored trips & co-marketing",
      "Dedicated creator manager",
      "Featured on Furlpay channels",
    ],
  },
];

const WEDGE = [
  {
    icon: Zap,
    title: "Paid weekly, not in 90 days",
    body: "Traditional travel programs pay 60–150 days after the trip is consumed. Furlpay settles your commission in USDC weekly, the moment a booking clears.",
  },
  {
    icon: Coins,
    title: "Up to 10% — flat, not split",
    body: "OTAs pay you a slice of their slice. Furlpay pays a flat gross commission on the booking value, so your effective rate is among the highest in travel.",
  },
  {
    icon: Globe,
    title: "No bank minimums, any country",
    body: "No $109 Booking.com threshold, no $150 bank wire. Get paid to any wallet, anywhere, from your first booking — global by default.",
  },
  {
    icon: ShieldCheck,
    title: "On-chain and verifiable",
    body: "Every booking and payout is recorded on-chain. No black-box dashboards or disputed attribution — your earnings are transparent and provable.",
  },
];

const STEPS = [
  { n: 1, title: "Apply in two minutes", body: "No follower minimum. We look for genuine travel content, not vanity metrics." },
  { n: 2, title: "Get your Travel Shop", body: "A personal storefront and trackable links across 2.2M+ stays and flights in 230+ countries." },
  { n: 3, title: "Share what you love", body: "Drop links in your bio, videos and posts. A 90-day cookie window captures delayed bookings." },
  { n: 4, title: "Earn USDC weekly", body: "Commission settles to your wallet every week. Track it live, on-chain, in your dashboard." },
];

const TOOLKIT = [
  { icon: Store, title: "Travel Shops", body: "Curated, bookable storefronts — group stays by destination, theme or budget." },
  { icon: LinkIcon, title: "Link Builder", body: "Deep links to any property, flight or city with automatic attribution." },
  { icon: BarChart3, title: "Live dashboard", body: "Clicks, bookings and USDC earnings in real time — verifiable on-chain." },
  { icon: Plane, title: "AI itineraries", body: "Let your audience plan trips with an AI agent that books through your links via x402." },
];

// FurlPay vs the field — the comparison that closes the creator.
const COMPARE: [string, string, string][] = [
  ["Payout speed", "60–150 days post-trip", "Weekly, on settlement"],
  ["Payout currency", "Local fiat, bank only", "USDC to any wallet"],
  ["Minimum threshold", "$50–$109", "$0"],
  ["Commission", "Split of the OTA's cut", "Up to 10% flat gross"],
  ["Cookie window", "30 days typical", "90 days"],
  ["Follower cashback", "Discount code only", "2% USDC + your code"],
  ["Transparency", "Black-box dashboard", "On-chain, verifiable"],
];

// Furlpay's own channels — creators follow, tag and get featured here.
const SOCIALS = [
  { Icon: InstagramIcon, href: "https://instagram.com/furlpay", label: "Instagram" },
  { Icon: XIcon, href: "https://x.com/furlpayglobal", label: "X" },
  { Icon: YouTubeIcon, href: "https://www.youtube.com/@furlpay", label: "YouTube" },
  { Icon: LinkedInIcon, href: "https://linkedin.com/company/furlpay", label: "LinkedIn" },
  { Icon: DiscordIcon, href: "/discord", label: "Discord" },
  { Icon: TelegramIcon, href: "/telegram", label: "Telegram" },
  { Icon: GitHubIcon, href: "https://github.com/Ashutosh0x/furlpay", label: "GitHub" },
];

export default function AmbassadorsPage() {
  return (
    <div className="min-h-screen bg-black text-textPrimary">
      <MarketingBar active="ambassadors" />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="hero-glow pointer-events-none absolute inset-0" />
        <div className="mx-auto max-w-6xl px-6 pb-8 pt-16 text-center">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-[12px] text-textSecondary">
            <span className="h-1.5 w-1.5 rounded-full bg-neon" /> Furlpay Creator Program
          </div>
          <h1 className="mx-auto max-w-3xl text-[40px] font-extrabold leading-[1.05] tracking-tighter sm:text-[58px]">
            Turn travel content into <span className="text-neon">instant USDC.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-relaxed text-textSecondary sm:text-[18px]">
            Earn up to 10% on every booking — paid weekly in USDC, on-chain, with no holds and no bank minimums.
            Your followers earn 2% cashback too. The best-paying travel creator program, built for the stablecoin era.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="#apply" className="rounded-pill bg-neon px-8 py-3.5 text-[15px] font-semibold text-black transition-transform hover:-translate-y-0.5">
              Apply now
            </a>
            <a href="#how" className="rounded-pill border border-white/15 px-8 py-3.5 text-[15px] font-semibold text-white transition-colors hover:border-white/40">
              How it works
            </a>
          </div>
          <div className="mx-auto mt-10 grid max-w-2xl grid-cols-3 gap-4">
            {[["10%", "top commission"], ["Weekly", "USDC payouts"], ["2.2M+", "stays & flights"]].map(([big, small]) => (
              <div key={small} className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-5">
                <div className="text-[26px] font-extrabold tracking-tight text-neon">{big}</div>
                <div className="mt-1 text-[12px] text-textSecondary">{small}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Creator reel — autoplaying travel content */}
      <section className="mx-auto max-w-5xl px-6 pt-6">
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02]">
          {/* Muted + playsInline so browsers allow autoplay; loops silently. */}
          <video
            className="h-auto w-full"
            src="/travel-content.mp4"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-label="Furlpay creator travel content"
          />
        </div>
      </section>

      {/* The wedge */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center text-[28px] font-extrabold tracking-tighter sm:text-[36px]">
          Why creators earn more with Furlpay
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-[15px] text-textSecondary">
          The programs you know pay slowly, in fiat, after a wait. We rebuilt the model on stablecoin rails.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {WEDGE.map((w) => (
            <div key={w.title} className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-neon/10">
                <w.icon className="h-5 w-5 text-neon" />
              </div>
              <h3 className="text-[17px] font-bold text-textPrimary">{w.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-textMuted">{w.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Tiers */}
      <section className="mx-auto max-w-6xl px-6 py-8">
        <h2 className="text-center text-[28px] font-extrabold tracking-tighter sm:text-[36px]">Three tiers. One goal: your earnings.</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-[15px] text-textSecondary">
          Start earning immediately as an Explorer; climb as you grow. Tiers upgrade automatically on volume.
        </p>
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`relative rounded-2xl border p-7 ${
                t.highlight ? "border-neon/50 bg-neon/[0.04]" : "border-white/10 bg-white/[0.02]"
              }`}
            >
              {t.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-neon px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-black">
                  Most popular
                </div>
              )}
              <h3 className="text-[20px] font-extrabold text-textPrimary">{t.name}</h3>
              <p className="text-[13px] text-textSecondary">{t.tagline}</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-[40px] font-extrabold tracking-tight text-neon">{t.commission}</span>
                <span className="text-[14px] text-textSecondary">commission</span>
              </div>
              <p className="mt-1 text-[12px] text-textSecondary">{t.threshold}</p>
              <ul className="mt-6 space-y-2.5">
                {t.perks.map((p) => (
                  <li key={p} className="flex gap-2.5 text-[14px] text-textMuted">
                    <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-neon/70" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center text-[28px] font-extrabold tracking-tighter sm:text-[36px]">From apply to paid in four steps</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
              <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-neon text-[15px] font-extrabold text-black">
                {s.n}
              </div>
              <h3 className="text-[16px] font-bold text-textPrimary">{s.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-textMuted">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison */}
      <section className="mx-auto max-w-4xl px-6 py-8">
        <h2 className="text-center text-[28px] font-extrabold tracking-tighter sm:text-[36px]">Furlpay vs. traditional travel programs</h2>
        <div className="mt-8 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[560px] border-collapse text-left text-[14px]">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02]">
                <th className="px-5 py-4 font-semibold text-textSecondary"></th>
                <th className="px-5 py-4 font-semibold text-textSecondary">Traditional OTAs</th>
                <th className="px-5 py-4 font-bold text-neon">Furlpay</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map(([label, ota, furl]) => (
                <tr key={label} className="border-b border-white/5 last:border-b-0">
                  <th className="px-5 py-3.5 text-left text-[13px] font-semibold uppercase tracking-wide text-textSecondary">{label}</th>
                  <td className="px-5 py-3.5 text-textMuted">{ota}</td>
                  <td className="bg-neon/[0.05] px-5 py-3.5 font-medium text-textPrimary">{furl}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Toolkit */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center text-[28px] font-extrabold tracking-tighter sm:text-[36px]">Your creator toolkit</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TOOLKIT.map((t) => (
            <div key={t.title} className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-neon/10">
                <t.icon className="h-5 w-5 text-neon" />
              </div>
              <h3 className="text-[16px] font-bold text-textPrimary">{t.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-textMuted">{t.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Peer referral */}
      <section className="mx-auto max-w-4xl px-6 py-8">
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-neon/[0.06] to-transparent p-8 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-neon/10">
            <Users className="h-5 w-5 text-neon" />
          </div>
          <h3 className="text-[22px] font-extrabold tracking-tight text-textPrimary">Refer creators, earn together</h3>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-textMuted">
            Every creator you bring in earns you a flat USDC reward when they make their first booking — and they
            get a head start too. Grow the network, grow your income.
          </p>
        </div>
      </section>

      {/* Apply */}
      <section id="apply" className="mx-auto max-w-3xl px-6 py-16">
        <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-8 sm:p-10">
          <h2 className="text-[28px] font-extrabold tracking-tighter sm:text-[34px]">Apply to the Creator Program</h2>
          <p className="mt-3 text-[15px] text-textMuted">
            We review applications in 3–5 business days and send an onboarding kit with your Travel Shop link.
          </p>
          <div className="mt-8">
            <AmbassadorForm />
          </div>
        </div>
        <p className="mt-6 text-center text-[13px] text-textSecondary">
          Questions? <Link href="/talk-to-us" className="text-neon underline underline-offset-2">Talk to us</Link> or join the{" "}
          <a href="/discord" className="text-neon underline underline-offset-2">Discord</a>.
        </p>
      </section>

      {/* Follow Furlpay — tag us to get featured */}
      <section className="mx-auto max-w-4xl px-6 pb-20">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-8 text-center">
          <h3 className="text-[18px] font-bold text-textPrimary">Follow Furlpay</h3>
          <p className="mx-auto mt-2 max-w-md text-[14px] text-textMuted">
            Tag <span className="text-neon">@furlpay</span> in your travel content — the best posts get featured
            across our channels, and creators reach them here first.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {SOCIALS.map(({ Icon, href, label }) => (
              <a
                key={label}
                href={href}
                aria-label={label}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-textSecondary transition-colors hover:border-neon/40 hover:text-neon"
              >
                <Icon className="h-5 w-5" />
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
