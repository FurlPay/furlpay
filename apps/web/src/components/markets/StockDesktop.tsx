"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bell, FileText, Search, Sparkles, User } from "lucide-react";
import { AssetLogo } from "@furlpay/ui";
import PriceChart from "@/components/PriceChart";
import AssetRow from "@/components/AssetRow";
import SignalBadge from "@/components/insights/SignalBadge";
import DesktopNav from "./DesktopNav";
import KeyStatsGrid from "./KeyStatsGrid";
import Provenance from "./Provenance";
import StockHeader from "./StockHeader";
import TradePanel from "./TradePanel";
import type { SymbolDetail } from "./types";

// The ticker page at desktop widths.
//
// Not the phone layout stretched: the phone stacks price → chart → actions →
// stats down one column because that is the only axis it has. With a second
// axis the actions and the statistics belong in a rail that stays put while the
// chart changes, which is the whole ergonomic argument for a terminal.
//
// Shares every piece with the phone build — StockHeader, PriceChart,
// KeyStatsGrid, Provenance, AssetRow — so a fix to a number's formatting lands
// on both. What differs is composition and scale, which is the part that should
// differ.
//
// Width is capped at 1440px and centred: a chart that keeps widening past that
// buys no resolution, and the eye loses the axis on the return sweep.

export default function StockDesktop({
  data,
  signInHref,
  onBuy,
  onSell,
}: {
  data: SymbolDetail;
  signInHref: string;
  onBuy: () => void;
  onSell: () => void;
}) {
  const router = useRouter();
  const { asset, quote, stats } = data;

  return (
    <div className="flex min-h-screen bg-oled">
      <DesktopNav />

      <div className="min-w-0 flex-1">
        {/* The burgundy wash sits behind the header only, exactly as on the
            phone: it marks the identity block, and running it down the whole
            page would tint the chart's own colours. */}
        <div className="app-ambient border-b border-white/[0.06]">
          <div className="mx-auto flex max-w-[1440px] items-center gap-4 px-8 py-5 2xl:px-12">
            <button
              onClick={() => router.back()}
              aria-label="Back"
              className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.05] transition-colors hover:bg-white/[0.1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <AssetLogo src={asset.logo} label={asset.symbol} size={44} />

            <div className="min-w-0">
              <h1 className="truncate text-[22px] font-bold leading-tight tracking-tight">
                {asset.symbol}
              </h1>
              <p className="truncate text-[13px] text-textSecondary">
                {asset.name}
                {(asset.sector ?? asset.exchange) && (
                  <span className="text-textMuted"> · {asset.sector ?? asset.exchange}</span>
                )}
              </p>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Link
                href="/markets"
                aria-label="Search markets"
                title="Search markets"
                className="tap flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.05] text-textSecondary transition-colors hover:bg-white/[0.1] hover:text-textPrimary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
              >
                <Search className="h-[18px] w-[18px]" />
              </Link>
              {/* Only rendered for a signed-in caller: an anonymous reader has
                  no notifications and no profile to open. */}
              {data.authenticated && (
                <>
                  <Link
                    href="/profile"
                    aria-label="Notifications"
                    title="Notifications"
                    className="tap flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.05] text-textSecondary transition-colors hover:bg-white/[0.1] hover:text-textPrimary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
                  >
                    <Bell className="h-[18px] w-[18px]" />
                  </Link>
                  <Link
                    href="/profile"
                    aria-label="Profile"
                    title="Profile"
                    className="tap flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.05] text-textSecondary transition-colors hover:bg-white/[0.1] hover:text-textPrimary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
                  >
                    <User className="h-[18px] w-[18px]" />
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Two columns. The rail is a fixed 372px rather than a fraction so the
            statistics keep their line lengths as the viewport grows — the chart
            takes the extra width, which is the only element that gains from it. */}
        <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-8 px-8 py-8 xl:grid-cols-[minmax(0,1fr)_372px] 2xl:px-12">
          <main className="min-w-0 space-y-6">
            <StockHeader
              price={quote.price}
              changePct={quote.changePct}
              stats={stats}
              variant="desktop"
            />

            {/* allowSynthetic={false}: under a real ticker, an invented price
                history is the one thing this chart must never draw. */}
            <section className="surface-card p-5">
              <PriceChart
                seed={`asset-${asset.symbol}`}
                symbol={asset.symbol}
                endValue={quote.price ?? 0}
                height={440}
                defaultTf="1M"
                allowSynthetic={false}
              />
            </section>

            {data.digest && (
              <section className="rounded-2xl border border-white/[0.07] bg-gradient-to-br from-white/[0.05] to-transparent p-5">
                <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-accent">
                  <Sparkles className="h-3.5 w-3.5" /> Furl AI digest
                </p>
                <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-textSecondary">
                  {data.digest}
                </p>
                <p className="mt-2 text-[10px] text-textMuted">
                  AI-generated summary. Not investment advice.
                </p>
              </section>
            )}

            <section>
              <h2 className="mb-3 text-[16px] font-bold tracking-tight">Key stats</h2>
              <KeyStatsGrid stats={stats} kind={asset.kind} />
            </section>

            <Provenance data={data.provenance} />

            {data.insights.length > 0 && (
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-[16px] font-bold tracking-tight">FurlPay Research</h2>
                  <Link
                    href="/investing/insights"
                    className="text-[12.5px] font-semibold text-accent hover:underline"
                  >
                    All insights →
                  </Link>
                </div>
                <div className="grid gap-2.5 md:grid-cols-2">
                  {data.insights.map((i) => (
                    <Link
                      key={i.slug}
                      href={`/investing/insights/${i.slug}`}
                      className="flex items-center gap-3 surface-card px-4 py-3.5 transition-colors hover:border-white/20"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-textMuted" />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-[13px] font-semibold leading-snug">
                          {i.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-textMuted">{i.readMins} min read</p>
                      </div>
                      {i.signal && <SignalBadge signal={i.signal} compact />}
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {data.related.length > 0 && (
              <section>
                <h2 className="mb-2 text-[16px] font-bold tracking-tight">Related</h2>
                <div className="grid gap-1 md:grid-cols-2">
                  {data.related.map((r) => (
                    <AssetRow
                      key={r.symbol}
                      item={r}
                      href={`/markets/${r.symbol}`}
                      size="sm"
                      sparkline={false}
                    />
                  ))}
                </div>
              </section>
            )}
          </main>

          {/* Sticky so the ticket stays reachable while the reader scrolls the
              filings below. `top-6` clears the header; `self-start` stops the
              grid stretching it to the row height, which would break sticky. */}
          <aside className="min-w-0 xl:sticky xl:top-6 xl:self-start">
            <TradePanel data={data} signInHref={signInHref} onBuy={onBuy} onSell={onSell} />
          </aside>
        </div>
      </div>
    </div>
  );
}
