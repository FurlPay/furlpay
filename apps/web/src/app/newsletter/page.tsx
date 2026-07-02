import Link from "next/link";
import type { Metadata } from "next";
import MarketingBar from "@/components/marketing/MarketingBar";
import NewsletterSignup from "@/components/newsletter/NewsletterSignup";

export const metadata: Metadata = {
  title: "Newsletter — Furlpay",
  description:
    "Subscribe to Furlpay's newsletter for product updates, engineering deep-dives, policy alerts, security bulletins, and a weekly market digest. No spam, ever.",
  alternates: { canonical: "/newsletter" },
};

const COMPARISON = [
  { category: "Product Updates", robinhood: true, coinbase: true, redotpay: true, furlpay: "✓" },
  { category: "Engineering Blog", robinhood: false, coinbase: true, redotpay: false, furlpay: "✓" },
  { category: "Policy Alerts", robinhood: "buried", coinbase: true, redotpay: false, furlpay: "proactive" },
  { category: "Security Bulletins", robinhood: false, coinbase: false, redotpay: false, furlpay: "transparent" },
  { category: "Weekly Digest", robinhood: false, coinbase: true, redotpay: false, furlpay: "✓" },
  { category: "Open Source Updates", robinhood: false, coinbase: false, redotpay: false, furlpay: "✓" },
] as const;

const FAQ = [
  {
    q: "How often will I receive emails?",
    a: "It depends on your selections. Product Updates and Engineering posts go out when we ship (typically 2–4 per month). The Weekly Digest lands every Monday. Security Bulletins are sent only when there's a genuine advisory.",
  },
  {
    q: "Can I unsubscribe anytime?",
    a: "Yes — every email includes a one-click unsubscribe link. You can also visit our unsubscribe page to selectively remove categories or opt out entirely.",
  },
  {
    q: "How does Furlpay handle my data?",
    a: "We store your email, selected categories, and a consent timestamp. We never sell or share your data with third parties. Full details are in our Privacy Policy.",
  },
  {
    q: "Is this GDPR compliant?",
    a: "Absolutely. We record explicit consent with a timestamp and category selection. You can modify or delete your data at any time by emailing privacy@furlpay.com.",
  },
];

function cell(val: boolean | string) {
  if (val === true) return <span className="text-textSecondary">✓</span>;
  if (val === false) return <span className="text-textMuted">✗</span>;
  return <span className="font-semibold text-neon">✓ ({val})</span>;
}

export default function NewsletterPage() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-14">
        {/* ── Hero ───────────────────────────────────────────────── */}
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">
          Newsletter
        </p>
        <h1 className="max-w-3xl text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[52px]">
          Updates worth reading,<br className="hidden sm:block" /> from a team that ships.
        </h1>
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-textSecondary">
          Product launches, engineering deep-dives, security bulletins, policy alerts, and a curated
          weekly digest — delivered to your inbox. Choose exactly what you care about.
        </p>

        {/* ── Signup card ────────────────────────────────────────── */}
        <div className="mt-14">
          <NewsletterSignup variant="card" />
        </div>

        {/* ── Comparison table ───────────────────────────────────── */}
        <h2 className="mt-20 text-[24px] font-bold tracking-tighter">
          How we compare
        </h2>
        <p className="mt-2 text-[15px] text-textSecondary">
          Most fintech newsletters are marketing blasts. Ours is an accountability channel.
        </p>

        <div className="mt-6 overflow-x-auto rounded-card border border-white/10 bg-white/[0.02]">
          <table className="w-full min-w-[600px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-white/10 text-textMuted">
                <th className="px-5 py-3 font-medium">Category</th>
                <th className="px-5 py-3 font-medium">Robinhood</th>
                <th className="px-5 py-3 font-medium">Coinbase</th>
                <th className="px-5 py-3 font-medium">RedotPay</th>
                <th className="px-5 py-3 font-medium">Furlpay</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.category} className="border-b border-white/5 last:border-none">
                  <td className="px-5 py-3 font-medium text-white">{row.category}</td>
                  <td className="px-5 py-3">{cell(row.robinhood)}</td>
                  <td className="px-5 py-3">{cell(row.coinbase)}</td>
                  <td className="px-5 py-3">{cell(row.redotpay)}</td>
                  <td className="px-5 py-3">{cell(row.furlpay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── FAQ ────────────────────────────────────────────────── */}
        <h2 className="mt-20 text-[24px] font-bold tracking-tighter">
          Frequently asked questions
        </h2>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FAQ.map((item) => (
            <div key={item.q} className="glass-card p-6">
              <p className="text-[14px] font-bold">{item.q}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-textSecondary">{item.a}</p>
            </div>
          ))}
        </div>

        {/* ── Footer CTA ─────────────────────────────────────────── */}
        <div className="mt-16 flex flex-wrap items-center gap-3">
          <Link href="/blog" className="btn-outline px-6 py-3 text-[15px]">
            Read the blog
          </Link>
          <Link href="/newsletter/unsubscribe" className="text-[13px] text-textMuted transition-colors hover:text-white">
            Manage preferences / unsubscribe →
          </Link>
        </div>
      </main>
    </div>
  );
}
