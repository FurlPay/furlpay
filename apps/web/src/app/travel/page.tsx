"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, CalendarCheck, Wallet, Coins, Plane, Bot, ArrowRight, Sparkles } from "lucide-react";
import { getJSON } from "@/lib/api";
import { Pill } from "@/components/ui";
import TravelHero from "@/components/travel/TravelHero";
import { DESTINATION_CATEGORIES, TRAVEL_STATS, type Deal } from "@/lib/travel/data";

const STEPS = [
  { Icon: Search, title: "Search", body: "Find stays, flights, cars & activities from 2.2M+ listings." },
  { Icon: CalendarCheck, title: "Book", body: "Pick your room, flight or car and add traveler info." },
  { Icon: Coins, title: "Pay", body: "Pay with USDC, SOL or 100+ cryptos. Instant settlement." },
  { Icon: Wallet, title: "Earn", body: "Get 2% cashback in USDC, auto-deposited to your wallet." },
  { Icon: Plane, title: "Travel", body: "Receive your confirmation and e-ticket instantly." },
];

const PARTNERS = ["Travala", "Visa", "Mastercard", "Solana", "USDC", "Coinbase", "Phantom", "Alpaca"];

export default function TravelHubPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [remaining, setRemaining] = useState(4 * 3600 + 23 * 60 + 15);

  useEffect(() => {
    getJSON<{ deals: Deal[] }>("/api/travel/deals").then((d) => setDeals(d.deals)).catch(() => {});
  }, []);
  useEffect(() => {
    const t = setInterval(() => setRemaining((r) => (r > 0 ? r - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  const hh = String(Math.floor(remaining / 3600)).padStart(2, "0");
  const mm = String(Math.floor((remaining % 3600) / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div className="mx-auto max-w-5xl px-5 pb-24 pt-8">
      {/* Hero */}
      <div className="mb-3 flex items-center gap-2">
        <Pill tone="accent">FurlPay Travels</Pill>
        <span className="text-xs text-textSecondary">Powered by Travala · Settled via x402</span>
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
        Book the world, <span className="text-neon">pay with crypto.</span>
      </h1>
      <p className="mt-2 max-w-xl text-sm text-textSecondary">
        2.2M+ stays and flights across 230+ countries. Pay with USDC, SOL, BTC or 100+ tokens — and earn 2%
        cashback on every booking.
      </p>
      <div className="mt-5">
        <TravelHero />
      </div>

      {/* Destination categories */}
      <section className="mt-12">
        <h2 className="mb-4 text-xl font-bold text-white">Explore by vibe</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DESTINATION_CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              href={`/travel/stays?city=${encodeURIComponent(c.examples[0])}`}
              className={`group relative overflow-hidden rounded-card border border-white/10 bg-gradient-to-br ${c.gradient} p-5 transition hover:border-white/25`}
            >
              <div className="absolute right-3 top-3">
                <Pill tone="gain">{c.tag}</Pill>
              </div>
              <h3 className="mt-8 text-lg font-bold text-white">{c.title}</h3>
              <p className="text-xs text-white/70">{c.blurb}</p>
              <p className="mt-3 text-[11px] text-white/60">{c.examples.join(" · ")}</p>
              <ArrowRight className="mt-3 h-4 w-4 text-white transition group-hover:translate-x-1" />
            </Link>
          ))}
        </div>
      </section>

      {/* Flash deals */}
      <section className="mt-12">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <Sparkles className="h-5 w-5 text-accent" /> Flash deals
          </h2>
          <span className="rounded-full bg-accent/15 px-3 py-1 font-mono text-xs font-semibold text-accent">
            Ends in {hh}:{mm}:{ss}
          </span>
        </div>
        <div className="flex snap-x gap-4 overflow-x-auto pb-2">
          {deals.map((d) => (
            <Link
              key={d.id}
              href={`/travel/checkout?ref=${d.id}&name=${encodeURIComponent(d.name)}&amount=${d.nightlyUsd}&nights=1`}
              className="w-56 shrink-0 snap-start overflow-hidden rounded-card border border-white/10 bg-charcoal transition hover:border-white/20"
            >
              <div className={`relative h-28 bg-gradient-to-br ${d.image}`}>
                <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-white">
                  {d.discountPct}% OFF
                </span>
                <span className="absolute bottom-2 right-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-semibold text-white">
                  Pay {d.payToken}
                </span>
              </div>
              <div className="p-3">
                <p className="text-sm font-semibold text-white">{d.city}</p>
                <p className="text-[11px] text-textSecondary">{d.name} · {d.stars}★</p>
                <p className="mt-1 text-base font-bold text-white">
                  ${d.nightlyUsd}
                  <span className="text-[11px] font-normal text-textSecondary"> /night</span>
                </p>
              </div>
            </Link>
          ))}
          {deals.length === 0 && <p className="py-8 text-sm text-textSecondary">Loading deals…</p>}
        </div>
      </section>

      {/* How it works */}
      <section className="mt-12">
        <h2 className="mb-4 text-xl font-bold text-white">How FurlPay Travel works</h2>
        <div className="grid gap-3 sm:grid-cols-5">
          {STEPS.map((s, i) => (
            <div key={s.title} className="rounded-card border border-white/10 bg-charcoal p-4">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-neon/15 text-neon">
                <s.Icon className="h-4 w-4" />
              </div>
              <p className="text-sm font-semibold text-white">{i + 1}. {s.title}</p>
              <p className="mt-1 text-[11px] text-textSecondary">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* AI agent banner */}
      <section className="mt-12 overflow-hidden rounded-card border border-white/10 bg-gradient-to-br from-violet-600/20 via-charcoal to-fuchsia-600/10 p-6">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-violet-300" />
          <h2 className="text-xl font-bold text-white">Let your AI agent book for you</h2>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-textSecondary">
          <span className="italic text-white/80">“Book me a 4-star hotel in Tokyo under $150/night for next weekend.”</span>
          {" "}FurlPay’s MCP server + Travala’s Travel MCP let your agent search, book, and pay autonomously over
          x402 — within a budget you approve once.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/travel/crypto-travel" className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/90">
            Learn more
          </Link>
          <a
            href="https://github.com/FurlPay/furlpay-travel-mcp"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.06]"
          >
            Try with Claude →
          </a>
        </div>
      </section>

      {/* Stats */}
      <section className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TRAVEL_STATS.map((s) => (
          <div key={s.label} className="rounded-card border border-white/10 bg-charcoal p-4 text-center">
            <p className="text-2xl font-bold text-white">{s.value}</p>
            <p className="mt-1 text-[11px] text-textSecondary">{s.label}</p>
          </div>
        ))}
      </section>

      {/* Partners */}
      <section className="mt-10">
        <p className="mb-3 text-center text-[11px] uppercase tracking-wider text-textSecondary">Payments & partners</p>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-semibold text-white/40">
          {PARTNERS.map((p) => (
            <span key={p}>{p}</span>
          ))}
        </div>
      </section>
    </div>
  );
}
