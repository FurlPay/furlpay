"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Users, Copy, Check, Mail } from "lucide-react";
import { getJSON } from "@/lib/api";
import { Spinner } from "@/components/ui";

type Stats = {
  code: string;
  link: string;
  referrals: number;
  earnedUsd: number;
  pending: number;
  referrerReward: number;
  refereeDiscount: number;
};

export default function ReferPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getJSON<Stats>("/api/travel/referral").then(setStats).catch(() => setStats(null));
  }, []);

  if (!stats) return <Spinner />;

  function copy() {
    navigator.clipboard?.writeText(stats!.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const tweet = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    "Book travel with crypto on FurlPay — 2% cashback in USDC. Use my link:",
  )}&url=${encodeURIComponent(stats.link)}`;

  return (
    <div className="mx-auto max-w-2xl px-5 pb-24 pt-6">
      <Link href="/travel" className="mb-3 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Travel
      </Link>

      <div className="flex items-center gap-2 text-sky-300">
        <Users className="h-6 w-6" />
        <span className="text-xs font-semibold uppercase tracking-wider">Invite &amp; Earn</span>
      </div>
      <h1 className="mt-3 text-2xl font-bold text-white">
        Share your link. Earn ${stats.referrerReward} per referral.
      </h1>
      <p className="mt-1 text-sm text-textSecondary">
        Your friend gets ${stats.refereeDiscount} off their first booking. You earn ${stats.referrerReward} in Travel
        Credits when they book.
      </p>

      <div className="mt-5 rounded-card border border-white/10 bg-charcoal p-4">
        <p className="text-xs text-textSecondary">Your referral link</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg bg-black/40 px-3 py-2.5 font-mono text-sm text-white">{stats.link}</code>
          <button onClick={copy} className="rounded-lg bg-neon px-3 py-2.5 text-black hover:bg-neonDeep">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <div className="mt-2 flex gap-2">
          <a
            href={tweet}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/[0.06] py-2.5 text-sm font-semibold text-white hover:bg-white/10"
          >
            Share on 𝕏
          </a>
          <a
            href={`mailto:?subject=${encodeURIComponent("Book travel with crypto on FurlPay")}&body=${encodeURIComponent(stats.link)}`}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/[0.06] py-2.5 text-sm font-semibold text-white hover:bg-white/10"
          >
            <Mail className="h-4 w-4" /> Email
          </a>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat value={stats.referrals} label="Referrals" />
        <Stat value={`$${stats.earnedUsd}`} label="Earned" highlight />
        <Stat value={stats.pending} label="Pending" />
      </div>
    </div>
  );
}

function Stat({ value, label, highlight }: { value: string | number; label: string; highlight?: boolean }) {
  return (
    <div className="rounded-card border border-white/10 bg-charcoal p-4 text-center">
      <p className={`text-2xl font-bold ${highlight ? "text-neon" : "text-white"}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-textSecondary">{label}</p>
    </div>
  );
}
