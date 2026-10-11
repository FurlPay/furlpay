"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, CloudOff, BadgePercent, Gift } from "lucide-react";
import { getJSON } from "@/lib/api";
import { Pill, Spinner } from "@/components/ui";
import type { Deal } from "@/lib/travel/data";
import EmptyState, { EMPTY_ACTION_PRIMARY, EMPTY_ACTION_SECONDARY } from "@/components/travel/EmptyState";
import { outcomeOf, reportSearchOutcome } from "@/lib/travel/searchTelemetry";

// No countdown, "flash sale" badge or "limited time" copy: a Deal carries no
// expiry from any provider, so any timer here would be invented urgency (it
// used to reset every 6 hours whatever the deals were). If a supplier ever
// supplies a real expiry, show THAT timestamp per deal, never a page clock.

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  /** "no_live_rate_provider" while no supplier publishes discounted rates. */
  const [unavailable, setUnavailable] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setFailed(false);
    getJSON<{ deals: Deal[]; unavailableReason?: string }>("/api/travel/deals")
      .then((d) => {
        setDeals(d.deals);
        setUnavailable(d.unavailableReason ?? null);
        reportSearchOutcome("deals", outcomeOf(d.deals.length, d.unavailableReason), { count: d.deals.length, reason: d.unavailableReason });
      })
      // A failed request is not "no deals".
      .catch(() => {
        setDeals([]);
        setFailed(true);
        reportSearchOutcome("deals", "failed");
      })
      .finally(() => setLoading(false));
  }, [reloadKey]);

  const best = deals.length ? Math.max(...deals.map((d) => d.discountPct)) : 0;

  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-6">
      <Link href="/travel" className="mb-3 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Travel
      </Link>

      {/* Hero */}
      <div className="rounded-card border border-white/10 bg-gradient-to-br from-rose-500/[0.10] via-charcoal to-amber-500/[0.08] p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          {best > 0 && <Pill tone="gain">Up to {best}% off</Pill>}
        </div>
        <h1 className="mt-2 flex items-center gap-2 text-3xl font-bold tracking-tight text-white">
          <BadgePercent className="h-7 w-7 text-accent" aria-hidden /> Travel deals
        </h1>
        <p className="mt-2 max-w-xl text-sm text-textSecondary">
          Discounted stay rates, shown only when a provider publishes both the regular and the discounted price.
          Checkout quotes are valid for 15 minutes and the server re-prices before you pay. Pay with USDC, SOL or BTC.
        </p>
      </div>

      {/* Deal grid */}
      <div className="mt-8">
        {loading ? (
          <Spinner />
        ) : failed ? (
          <EmptyState
            role="alert"
            icon={<CloudOff className="h-5 w-5" />}
            title="Deals couldn't load"
            actions={<button type="button" onClick={() => setReloadKey((k) => k + 1)} className={EMPTY_ACTION_PRIMARY}>Try again</button>}
          >
            Something went wrong reaching the deals service.
          </EmptyState>
        ) : deals.length === 0 ? (
          <EmptyState
            icon={<BadgePercent className="h-5 w-5" />}
            title={unavailable === "no_live_rate_provider" ? "Deals aren't connected yet" : "No live deals right now"}
            actions={
              <>
                <Link href="/travel?focus=search" className={EMPTY_ACTION_PRIMARY}>Search stays</Link>
                <Link href="/travel/destinations" className={EMPTY_ACTION_SECONDARY}>Browse destinations</Link>
              </>
            }
          >
            {unavailable === "no_live_rate_provider"
              ? "A deal needs a live regular rate and a live discounted rate from a provider. No rate provider is connected, so there is nothing honest to show — rather than invented discounts."
              : "Deals appear here only when a provider publishes a real discounted rate."}
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[...deals]
              .sort((a, b) => b.discountPct - a.discountPct)
              .map((d) => {
                const original = Math.round((d.nightlyUsd / (1 - d.discountPct / 100)) * 100) / 100;
                return (
                  <Link
                    key={d.id}
                    href={`/travel/checkout?kind=stay&ref=${d.id}&name=${encodeURIComponent(d.name)}&amount=${d.nightlyUsd}&nights=1&img=${encodeURIComponent(d.photo)}`}
                    className="group overflow-hidden rounded-card border border-white/10 bg-charcoal transition hover:border-white/25 hover:shadow-glow-sm"
                  >
                    <div className="relative h-36 overflow-hidden">
                      <img
                        src={d.photo}
                        alt={`${d.name}, ${d.city}`}
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                      <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-white">
                        <BadgePercent className="h-3 w-3" /> {d.discountPct}% OFF
                      </span>
                      <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
                        Pay {d.payToken}
                      </span>
                    </div>
                    <div className="p-4">
                      <p className="text-sm font-semibold text-white">{d.city}, {d.country}</p>
                      <p className="text-[11px] text-textSecondary">
                        {d.name} · {d.stars}★
                      </p>
                      <div className="mt-2 flex items-end gap-2">
                        <p className="text-xl font-bold text-white">${d.nightlyUsd}</p>
                        <p className="pb-0.5 text-xs text-textSecondary line-through">${original}</p>
                        <p className="pb-0.5 text-[11px] text-textSecondary">/night</p>
                      </div>
                      <p className="mt-2 text-[11px] font-semibold text-emerald-400">
                        15-minute checkout quote
                      </p>
                    </div>
                  </Link>
                );
              })}
          </div>
        )}
      </div>

      {/* Cross-sell */}
      <div className="mt-10 flex flex-wrap items-center justify-center gap-2 text-sm">
        <Link href="/travel/stays" className="rounded-lg border border-white/15 px-4 py-2 font-semibold text-white transition hover:bg-white/[0.06]">
          Search all stays
        </Link>
        <Link href="/travel/destinations" className="rounded-lg border border-white/15 px-4 py-2 font-semibold text-white transition hover:bg-white/[0.06]">
          Browse destinations
        </Link>
        <Link href="/travel/gift-cards" className="rounded-lg border border-white/15 px-4 py-2 font-semibold text-white transition hover:bg-white/[0.06]">
          <span className="flex items-center gap-1.5"><Gift className="h-4 w-4" /> Gift a trip</span>
        </Link>
      </div>
    </div>
  );
}
