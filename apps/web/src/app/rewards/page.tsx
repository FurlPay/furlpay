"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Check, Copy, Gift, Users } from "lucide-react";
import { getJSON } from "@/lib/api";
import { Spinner, usd } from "@/components/ui";

interface RewardsData {
  referral: { code: string; url: string; invited: number; converted: number; earnedUsd: number; perReferralUsd: number };
  membership: { tier: string; nextTier: string | null; points: number; nextThreshold: number; progressPct: number; perks: string[] };
  missions: { id: string; title: string; reward: number; done: boolean }[];
  rewardsBalance: { claimedUsd: number; pendingUsd: number };
}

export default function RewardsPage() {
  const [data, setData] = useState<RewardsData | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    // A 503 means the rewards program is not live on this deployment
    // (REWARDS_LIVE). Say so instead of spinning forever.
    getJSON<RewardsData>("/api/rewards").then(setData).catch(() => setUnavailable(true));
  }, []);
  if (unavailable) {
    return (
      <div className="px-4 pt-6">
        <h1 className="text-[22px] font-bold tracking-tight">Rewards</h1>
        <p className="mt-3 text-sm text-white/60">
          Rewards aren&apos;t available yet. Nothing has been earned or tracked on your account.
        </p>
      </div>
    );
  }
  if (!data) return <Spinner />;
  const { referral: r, membership: m } = data;

  function copy() {
    navigator.clipboard?.writeText(r.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <>
      <header className="flex items-center gap-3 px-4 pb-4 pt-3">
        <Link href="/dashboard" aria-label="Back" className="tap rounded-full border border-white/[0.08] bg-white/[0.04] p-2">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-[22px] font-bold tracking-tight">Rewards</h1>
      </header>

      {/* Rewards balance hero */}
      <section className="px-5">
        <div className="app-hero p-5">
          <p className="text-[13px] text-white/70">Rewards earned</p>
          <p className="mt-1 text-[40px] font-extrabold leading-none tracking-tighter text-neon">
            {usd(data.rewardsBalance.claimedUsd)}
          </p>
          <p className="mt-2 text-[12px] text-white/60">
            {usd(data.rewardsBalance.pendingUsd)} more available to claim
          </p>
        </div>
      </section>

      {/* Membership tier */}
      <section className="mt-6 px-5">
        <div className="glow-border p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] uppercase tracking-wider text-textSecondary">Membership</p>
              <p className="text-[20px] font-extrabold tracking-tight text-neon">{m.tier}</p>
            </div>
            <span className="text-[13px] text-textSecondary">{m.points.toLocaleString()} pts</span>
          </div>
          {m.nextTier && (
            <div className="mt-4">
              <div className="mb-1.5 flex justify-between text-[12px] text-textSecondary">
                <span>Progress to {m.nextTier}</span>
                <span>{m.progressPct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
                <div className="h-full rounded-full bg-neon" style={{ width: `${m.progressPct}%` }} />
              </div>
            </div>
          )}
          <ul className="mt-4 space-y-2">
            {m.perks.map((perk) => (
              <li key={perk} className="flex items-center gap-2 text-[13px] text-textMuted">
                <Check className="h-4 w-4 shrink-0 text-neon" /> {perk}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Referrals */}
      <section id="referrals" className="mt-7 scroll-mt-20 px-5">
        <h2 className="mb-3 flex items-center gap-2 text-[17px] font-bold tracking-tight">
          <Users className="h-5 w-5 text-neon" /> Invite friends
        </h2>
        <div className="surface-card p-5">
          <p className="text-[13px] text-textSecondary">
            Earn {usd(r.perReferralUsd)} for every friend who signs up and verifies.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/30 p-2 pl-4">
            <span className="flex-1 truncate font-mono text-[13px]">{r.url}</span>
            <button onClick={copy} className="tap flex items-center gap-1.5 rounded-pill bg-neon px-4 py-2 text-[13px] font-bold text-black">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <MiniStat label="Invited" value={String(r.invited)} />
            <MiniStat label="Joined" value={String(r.converted)} />
            <MiniStat label="Earned" value={usd(r.earnedUsd)} />
          </div>
        </div>
      </section>

      {/* Mission center */}
      <section className="mt-7 px-5">
        <h2 className="mb-3 flex items-center gap-2 text-[17px] font-bold tracking-tight">
          <Gift className="h-5 w-5 text-neon" /> Mission center
        </h2>
        <div className="surface-card divide-y divide-white/[0.06]">
          {data.missions.map((mi) => (
            <div key={mi.id} className="flex items-center gap-3 p-4">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  mi.done ? "bg-neon text-black" : "border border-white/15 text-textSecondary"
                }`}
              >
                {mi.done ? <Check className="h-4 w-4" /> : <Gift className="h-4 w-4" />}
              </span>
              <p className={`flex-1 text-[14px] ${mi.done ? "text-textMuted line-through" : "font-medium"}`}>
                {mi.title}
              </p>
              <span className={`text-[13px] font-bold ${mi.done ? "text-textMuted" : "text-neon"}`}>
                +{usd(mi.reward)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] px-2 py-2.5">
      <p className="text-[15px] font-bold tracking-tight">{value}</p>
      <p className="text-[11px] text-textSecondary">{label}</p>
    </div>
  );
}
