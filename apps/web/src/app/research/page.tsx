import Link from "next/link";
import { ArrowRight, ArrowDownToLine, Globe2 } from "lucide-react";
import JsonLd from "@/components/JsonLd";
import LandingChrome from "@/components/landing/LandingChrome";
import { seoMetadata } from "@/lib/seo/meta";
import { breadcrumb } from "@/lib/seo/schema";

export const metadata = seoMetadata({
  title: "Research",
  description:
    "Read FurlPay research on stablecoins and global payments. The FurlPay Global Stablecoin Report 2026 is free to read and download, with no signup required.",
  path: "/research",
  ogTitle: "FurlPay Research",
});

export default function ResearchPage() {
  return (
    <div className="min-h-screen bg-oled text-textPrimary">
      <LandingChrome />
      <JsonLd data={breadcrumb([{ name: "Home", path: "/" }, { name: "Research", path: "/research" }])} />
      <main className="section pb-24 pt-14">
        <header className="max-w-3xl">
          <p className="section-eyebrow">FurlPay Research</p>
          <h1 className="mt-4 text-[40px] font-extrabold leading-[1.08] tracking-tighter sm:text-[54px]">
            A closer look at<br className="hidden sm:block" /> money in motion.
          </h1>
          <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-textSecondary">
            Research on stablecoins, the networks behind them and their role in global payments.
            Read the full report and explore the evidence.
          </p>
        </header>

        <section aria-labelledby="report-heading" className="mt-12">
          <article className="overflow-hidden rounded-card border border-neon/25 bg-gradient-to-br from-neon/[0.07] via-white/[0.02] to-transparent">
            <div className="grid lg:grid-cols-[0.65fr_1.35fr]">
              <div aria-hidden="true" className="relative flex min-h-[250px] flex-col justify-between overflow-hidden border-b border-white/10 bg-black/30 p-8 sm:p-10 lg:border-b-0 lg:border-r">
                <div className="absolute -left-16 bottom-0 h-64 w-64 rounded-full border border-neon/20" />
                <div className="absolute -left-8 bottom-8 h-48 w-48 rounded-full border border-neon/15" />
                <p className="relative text-[11px] font-semibold uppercase tracking-[0.2em] text-neon">Annual report</p>
                <div className="relative mt-10">
                  <p className="text-[30px] font-extrabold leading-tight tracking-tighter">Global Stablecoin<br />Report</p>
                  <p className="mt-3 text-[64px] font-extrabold leading-none tracking-tighter text-neon">2026</p>
                </div>
              </div>

              <div className="p-6 sm:p-10">
                <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-textMuted">
                  Stablecoins · 2 October 2026
                </p>
                <h2 id="report-heading" className="mt-3 text-[28px] font-extrabold leading-tight tracking-tighter sm:text-[34px]">
                  <Link href="/reports/global-stablecoin-report-2026" className="transition-colors hover:text-neon">
                    FurlPay Global Stablecoin Report 2026
                  </Link>
                </h2>
                <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-textSecondary">
                  Fifty pages on where stablecoins actually move money. Supply, issuers, USDC
                  and USDT, card-network settlement, cross-border flows, 23 market profiles and
                  regulation, with every major figure labelled by source type.
                </p>
                <div className="mt-7 flex flex-wrap gap-3">
                  <Link href="/reports/global-stablecoin-report-2026" className="btn-green inline-flex items-center gap-2 px-6 py-3 text-[14px]">
                    Explore the report <ArrowRight aria-hidden className="h-4 w-4" />
                  </Link>
                  <a
                    href="/reports/global-stablecoin-report-2026.pdf"
                    download="FurlPay-Global-Stablecoin-Report-2026.pdf"
                    className="btn-outline inline-flex items-center gap-2 px-6 py-3 text-[14px]"
                  >
                    Download PDF <ArrowDownToLine aria-hidden className="h-4 w-4" />
                  </a>
                </div>
                <p className="mt-5 flex items-center gap-2 text-[13px] text-textSecondary">
                  <Globe2 aria-hidden className="h-4 w-4 shrink-0 text-neon" />
                  Free public access. No signup required.
                </p>
              </div>
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
