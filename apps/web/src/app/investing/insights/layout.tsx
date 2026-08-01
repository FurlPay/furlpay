import Link from "next/link";
import InsightSearch from "@/components/insights/InsightSearch";
import InsightCategoryTabs from "@/components/insights/InsightCategoryTabs";

// FurlPay Research portal shell (furlpay.com/investing/insights): sticky
// header with nav + search, category selector beneath — mirrors the blog.
export default function InsightsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-oled">
      <header className="sticky top-0 z-50 border-b border-white/5 bg-black/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <Logo />
            <span className="text-xl font-extrabold tracking-tighter">Furlpay</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-textSecondary md:flex">
            <Link href="/#features" className="transition-colors hover:text-white">Features</Link>
            <Link href="/docs" className="transition-colors hover:text-white">Docs</Link>
            <Link href="/blog" className="transition-colors hover:text-white">Blog</Link>
            <Link href="/investing/insights" className="text-white transition-colors">Insights</Link>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <InsightSearch />
            <Link href="/investing" className="btn-green flex-shrink-0 px-4 py-2 text-sm">
              Open App
            </Link>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-6 pb-3">
          <InsightCategoryTabs />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">{children}</main>

      <footer className="border-t border-white/5">
        <div className="mx-auto max-w-6xl px-6 py-8 text-[12px] text-textMuted">
          <p className="max-w-3xl leading-relaxed">
            FurlPay Research content is for information only and is not investment advice. Markets are volatile;
            past performance does not guarantee future results. Crypto assets are unregulated in some jurisdictions.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <span>© 2026 Furlpay. All rights reserved.</span>
            <div className="flex gap-5">
              <Link href="/" className="hover:text-white">Home</Link>
              <Link href="/markets" className="hover:text-white">Markets</Link>
              <Link href="/blog" className="hover:text-white">Blog</Link>
              <Link href="/legal/risk-disclosure" className="hover:text-white">Risk disclosure</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Logo() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-neon shadow-glow-sm">
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-black" fill="none" stroke="currentColor" strokeWidth="3">
        <path d="M5 5h14M5 12h10M5 19h6" strokeLinecap="round" />
      </svg>
    </span>
  );
}
