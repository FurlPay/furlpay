"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AssetLogo } from "@furlpay/ui";
import { logoForSymbol } from "@/lib/markets/logoFor";

// ---------------------------------------------------------------------------
// News & Insights — the bottom panel of the intelligence rail.
//
// THERE IS NO NEWS API IN THIS CODEBASE, and this panel does not pretend
// otherwise. The reference composition shows headlines attributed to Bloomberg,
// Reuters and CoinDesk; publishing those bylines over text this app wrote would
// be attributing fabricated reporting to real news organisations, which is the
// single worst thing on the whole page.
//
// What DOES exist is FurlPay Research (lib/insights/articles.ts) — long-form
// analysis published by this company, already served by /api/insights and
// already rendered at /investing/insights. That is real editorial with a real
// author and a real date, so it is what the panel shows, attributed honestly to
// "FurlPay Research" rather than to a wire service.
//
// Each item is tagged with the first ticker the article actually covers, which
// is what makes the panel useful next to a market table rather than decorative.
// ---------------------------------------------------------------------------

interface InsightItem {
  slug: string;
  title: string;
  category: string;
  date: string;
  readMins: number;
  tickers: string[];
}

export default function NewsInsights() {
  const [items, setItems] = useState<InsightItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/insights?limit=4", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ items: InsightItem[] }>) : Promise.reject(r.status)))
      .then((d) => {
        if (!cancelled) setItems(d.items);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="surface-card p-3.5" aria-labelledby="news-heading">
      <h2 id="news-heading" className="text-[13.5px] font-bold text-white">
        News &amp; Insights
      </h2>

      {failed ? (
        <p className="mt-2.5 text-[11.5px] text-textMuted">
          Research could not be loaded right now.
        </p>
      ) : !items ? (
        <div className="mt-2.5 space-y-2.5" aria-hidden>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-white/[0.04]" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="mt-2.5 text-[11.5px] text-textMuted">No research published yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-white/[0.05]">
          {items.map((item) => {
            const ticker = item.tickers[0] ?? null;
            return (
              <li key={item.slug}>
                <Link
                  href={`/investing/insights/${item.slug}`}
                  className="block rounded-lg px-1 py-2.5 transition-colors hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                >
                  {ticker && (
                    <span className="mb-1.5 flex items-center gap-1.5">
                      <AssetLogo src={logoForSymbol(ticker)} label={ticker} size={16} className="shrink-0" />
                      <span className="text-[10.5px] font-bold text-textSecondary">{ticker}</span>
                    </span>
                  )}
                  <span className="block text-[12px] font-semibold leading-snug text-white/85 line-clamp-2">
                    {item.title}
                  </span>
                  <span className="mt-1 block text-[10.5px] text-textMuted">
                    {/* Attributed to who actually wrote it. */}
                    FurlPay Research · {formatDate(item.date)} · {item.readMins} min read
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Link
        href="/investing/insights"
        className="mt-2 block w-full rounded-lg border border-white/[0.08] py-1.5 text-center text-[11.5px] font-semibold text-textSecondary transition-colors hover:border-white/20 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        View all research →
      </Link>
    </section>
  );
}

/** "Aug 14" for this year, "Aug 14, 2025" otherwise — the year only earns its
 *  space when it disambiguates. */
function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}
