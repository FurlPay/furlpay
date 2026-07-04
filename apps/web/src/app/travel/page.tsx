"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Search,
  CalendarCheck,
  Wallet,
  Coins,
  Plane,
  Bot,
  ArrowRight,
  Sparkles,
  Trophy,
  Gift,
  Users,
  Building2,
  BookOpen,
  Luggage,
  MessageCircleQuestion,
} from "lucide-react";
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
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-8">
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
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Explore by vibe</h2>
          <Link href="/travel/destinations" className="text-sm text-neon hover:underline">
            All destinations →
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DESTINATION_CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              href={`/travel/destinations/${c.slug}`}
              className="group relative min-h-[190px] overflow-hidden rounded-card border border-white/10 transition hover:border-white/30 hover:shadow-glow-sm"
            >
              <img
                src={c.photo}
                alt={c.title}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />
              <div className="relative flex h-full min-h-[190px] flex-col p-5">
                <div className="flex justify-end">
                  <Pill tone="gain">{c.tag}</Pill>
                </div>
                <div className="mt-auto">
                  <h3 className="text-lg font-bold text-white">{c.title}</h3>
                  <p className="text-xs text-white/75">{c.blurb}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <p className="text-[11px] text-white/60">{c.examples.join(" · ")}</p>
                    <ArrowRight className="h-4 w-4 shrink-0 text-white transition group-hover:translate-x-1" />
                  </div>
                </div>
              </div>
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
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-accent/15 px-3 py-1 font-mono text-xs font-semibold text-accent">
              Ends in {hh}:{mm}:{ss}
            </span>
            <Link href="/travel/deals" className="text-sm text-neon hover:underline">
              View all deals →
            </Link>
          </div>
        </div>
        <div className="flex snap-x gap-4 overflow-x-auto pb-2">
          {deals.map((d) => (
            <Link
              key={d.id}
              href={`/travel/checkout?ref=${d.id}&name=${encodeURIComponent(d.name)}&amount=${d.nightlyUsd}&nights=1`}
              className="group w-56 shrink-0 snap-start overflow-hidden rounded-card border border-white/10 bg-charcoal transition hover:border-white/25 hover:shadow-glow-sm"
            >
              <div className="relative h-28 overflow-hidden">
                <img
                  src={d.photo}
                  alt={`${d.name}, ${d.city}`}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-white">
                  {d.discountPct}% OFF
                </span>
                <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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

      {/* More from Travels */}
      <section className="mt-12">
        <h2 className="mb-4 text-xl font-bold text-white">More from FurlPay Travels</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { href: "/travel/rewards", Icon: Trophy, tint: "text-amber-400 bg-amber-400/10", title: "Travel Rewards", body: "2–7% USDC cashback, four tiers." },
            { href: "/travel/gift-cards", Icon: Gift, tint: "text-rose-400 bg-rose-400/10", title: "Gift Cards", body: "$25–$500, instant email delivery." },
            { href: "/travel/refer", Icon: Users, tint: "text-sky-400 bg-sky-400/10", title: "Invite & Earn", body: "$25 per referral in travel credits." },
            { href: "/travel/business", Icon: Building2, tint: "text-violet-400 bg-violet-400/10", title: "Business Travel", body: "Team wallets, VCNs & policies." },
            { href: "/travel/guides", Icon: BookOpen, tint: "text-emerald-400 bg-emerald-400/10", title: "Travel Guides", body: "Tips, tutorials & destination guides." },
            { href: "/travel/my-trips", Icon: Luggage, tint: "text-teal-400 bg-teal-400/10", title: "My Trips", body: "Upcoming, past & cancelled bookings." },
            { href: "/travel/crypto-travel", Icon: Coins, tint: "text-yellow-400 bg-yellow-400/10", title: "Crypto Travel 101", body: "How paying with crypto works." },
            { href: "/travel/help", Icon: MessageCircleQuestion, tint: "text-fuchsia-400 bg-fuchsia-400/10", title: "Help & FAQ", body: "Bookings, refunds & rate locks." },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="group rounded-card border border-white/10 bg-charcoal p-4 transition hover:border-white/25 hover:shadow-glow-sm"
            >
              <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${l.tint}`}>
                <l.Icon className="h-[18px] w-[18px]" />
              </span>
              <p className="mt-2.5 flex items-center gap-1 text-sm font-semibold text-white">
                {l.title}
                <ArrowRight className="h-3.5 w-3.5 text-neon opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
              </p>
              <p className="mt-1 text-[11px] text-textSecondary">{l.body}</p>
            </Link>
          ))}
        </div>
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
