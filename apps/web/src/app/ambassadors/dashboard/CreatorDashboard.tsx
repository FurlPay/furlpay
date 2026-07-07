"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  ShieldCheck,
  ExternalLink,
  Copy,
  Check,
  Store,
  ArrowUpRight,
  TrendingUp,
  Lock,
  BadgeCheck,
  Pencil,
  UserPlus,
  UserCheck,
} from "lucide-react";
import type { CreatorView } from "@/lib/creator";
import ProfileEditor, { Avatar } from "./ProfileEditor";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fmtUsdc = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n: number) => n.toLocaleString("en-US");
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const shortHash = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

const OTHER_CREATORS = [
  { name: "Sarah Chen", email: "sarah.chen@travel.io", handle: "sarah_explorer", audience: "10,000+" },
  { name: "Marcus Vance", email: "marcus@vanceventures.co", handle: "marcus_wanders", audience: "1,000 – 10,000" },
  { name: "Elena Rostova", email: "elena.ro@globe.com", handle: "elena_travels", audience: "100,000+" },
  { name: "Kenji Sato", email: "sato.kenji@tokyo.net", handle: "kenji_ryokans", audience: "1,000 – 10,000" },
  { name: "Chloe Dupont", email: "chloe@parisguide.fr", handle: "chloe_dupont", audience: "10,000+" },
];

export default function CreatorDashboard({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [input, setInput] = useState(initialEmail);
  const [data, setData] = useState<CreatorView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [followBusy, setFollowBusy] = useState<string | null>(null);

  const load = useCallback(async (e: string) => {
    if (!EMAIL_RE.test(e)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ambassadors?email=${encodeURIComponent(e)}&viewerEmail=${encodeURIComponent(e)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not load your dashboard.");
      setData(json.creator as CreatorView);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleFollow = async (followeeEmail: string, isFollowing: boolean) => {
    if (!data) return;
    setFollowBusy(followeeEmail);
    try {
      if (isFollowing) {
        const res = await fetch(`/api/ambassadors/follow?followerEmail=${encodeURIComponent(data.email)}&followeeEmail=${encodeURIComponent(followeeEmail)}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed to unfollow");
      } else {
        const res = await fetch("/api/ambassadors/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ followerEmail: data.email, followeeEmail }),
        });
        if (!res.ok) throw new Error("Failed to follow");
      }
      await load(data.email);
    } catch (err) {
      console.error(err);
    } finally {
      setFollowBusy(null);
    }
  };

  useEffect(() => {
    if (EMAIL_RE.test(initialEmail)) load(initialEmail);
  }, [initialEmail, load]);


  // Email-entry gate when no valid email is in the URL yet.
  if (!EMAIL_RE.test(email) || (!data && !loading && error)) {
    return (
      <div className="mx-auto max-w-md px-6 py-20">
        <h1 className="text-[26px] font-extrabold tracking-tighter">Creator dashboard</h1>
        <p className="mt-2 text-[14px] text-textMuted">
          Enter the email you applied with to view your live earnings.
        </p>
        <form
          className="mt-6 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setEmail(input.trim());
            load(input.trim());
          }}
        >
          <input
            type="email"
            value={input}
            onChange={(ev) => setInput(ev.target.value)}
            placeholder="you@email.com"
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[14px] text-textPrimary placeholder:text-textSecondary focus:border-neon/50 focus:outline-none"
          />
          {error && <p className="text-[13px] text-red-400">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-pill bg-neon py-3 text-[15px] font-semibold text-black transition-transform hover:-translate-y-0.5"
          >
            View dashboard
          </button>
        </form>
        <p className="mt-6 text-center text-[13px] text-textSecondary">
          Not a creator yet?{" "}
          <Link href="/ambassadors#apply" className="text-neon underline underline-offset-2">
            Apply to the program
          </Link>
        </p>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-neon" />
      </div>
    );
  }

  const { tier, earnings, month, voyager } = data;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <Avatar name={data.name} avatarUrl={data.avatarUrl} size={56} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-[22px] font-extrabold tracking-tight">{data.name}</h1>
              {data.kycVerified && <BadgeCheck className="h-5 w-5 flex-shrink-0 text-neon" aria-label="Verified" />}
            </div>
            <p className="text-[13px] text-textSecondary">
              {data.handle ? `@${data.handle.replace(/^@/, "")}` : data.email}
              {data.country ? ` · ${data.country}` : ""}
            </p>
            {data.bio && <p className="mt-1 max-w-md text-[13px] text-textMuted">{data.bio}</p>}
            {data.followers && data.followers.length > 0 && (
              <div className="mt-2.5 flex items-center gap-2">
                <div className="flex -space-x-1.5 overflow-hidden">
                  {data.followers.slice(0, 5).map((f) => (
                    <div key={f.email} className="inline-block rounded-full ring-2 ring-black">
                      <Avatar name={f.name} avatarUrl={f.avatarUrl} size={20} />
                    </div>
                  ))}
                </div>
                <span className="text-[11px] text-textMuted">
                  Followed by <span className="font-semibold text-neon">{data.followers.length}</span> creators
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-neon/40 bg-neon/10 px-3 py-1.5 text-[12px] font-bold text-neon">
            {tier.name} · {tier.commission}%
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12px] text-textMuted">
            Next payout {fmtDate(data.nextPayoutDate)}
          </span>
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[12px] font-semibold text-textPrimary transition-colors hover:border-neon/40 hover:text-neon"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit profile
          </button>
        </div>
      </div>

      {editing && (
        <ProfileEditor
          creator={data}
          onSaved={(updated) => setData(updated)}
          onClose={() => setEditing(false)}
        />
      )}

      {/* KYC banner */}
      {!data.kycVerified && (
        <div className="mt-6 flex flex-col items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 flex-shrink-0 text-amber-400" />
            <p className="text-[14px] text-textMuted">
              <b className="text-textPrimary">Verify your identity</b> to unlock automatic USDC payouts. Takes ~60 seconds.
            </p>
          </div>
          <a
            href="https://withpersona.com/demo"
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap rounded-pill bg-amber-400 px-5 py-2 text-[13px] font-semibold text-black"
          >
            Verify with Persona
          </a>
        </div>
      )}

      {/* Earnings */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pending (this week)" value={`$${fmtUsdc(earnings.pendingUsdc)}`} sub="USDC accruing" />
        <Stat label="Cleared" value={`$${fmtUsdc(earnings.clearedUsdc)}`} sub="Pays out Monday" highlight />
        <Stat label="Paid out" value={`$${fmtUsdc(earnings.paidOutUsdc)}`} sub="Lifetime settled" />
        <Stat label="Lifetime" value={`$${fmtUsdc(earnings.lifetimeUsdc)}`} sub="All-time USDC" />
      </div>

      {/* Month + cashback */}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Clicks (30d)" value={fmtInt(month.clicks)} />
        <Stat label="Bookings (30d)" value={fmtInt(month.bookings)} />
        <Stat label="Conversion" value={`${month.conversion}%`} />
        <Stat label="Follower cashback" value={`$${fmtUsdc(data.followerCashbackUsdc)}`} sub="2% USDC to fans" />
      </div>

      {/* Referral + Travel Shop */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <CopyCard label="Your referral code" value={data.referralCode} copyValue={data.referralCode} mono />
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-neon/10">
              <Store className="h-5 w-5 text-neon" />
            </span>
            <div>
              <p className="text-[13px] text-textSecondary">Your Travel Shop</p>
              <p className="text-[14px] font-semibold text-textPrimary">Ready to share</p>
            </div>
          </div>
          <a
            href={data.travelShopUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-pill bg-neon px-4 py-2 text-[13px] font-semibold text-black"
          >
            Launch <ArrowUpRight className="h-4 w-4" />
          </a>
        </div>
      </div>

      {/* Next-tier progress */}
      {!voyager.unlocked && (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-neon" />
            <h3 className="text-[15px] font-bold">Progress to Voyager (8%)</h3>
            <Lock className="ml-auto h-4 w-4 text-textSecondary" />
          </div>
          <Progress label="Bookings / month" value={voyager.bookings} target={voyager.bookingsTarget} />
          <div className="mt-3">
            <Progress label="Followers" value={voyager.followers} target={voyager.followersTarget} />
          </div>
          <p className="mt-3 text-[12px] text-textSecondary">
            Hit either target to auto-upgrade to Voyager — 8% commission, custom follower codes and up to $300/mo bonus.
          </p>
        </div>
      )}

      {/* Links */}
      <Section title="Your links">
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[560px] border-collapse text-left text-[14px]">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02] text-[12px] uppercase tracking-wide text-textSecondary">
                <th className="px-5 py-3 font-semibold">Channel</th>
                <th className="px-5 py-3 font-semibold">Clicks</th>
                <th className="px-5 py-3 font-semibold">Bookings</th>
                <th className="px-5 py-3 font-semibold">USDC</th>
                <th className="px-5 py-3 font-semibold text-right">Link</th>
              </tr>
            </thead>
            <tbody>
              {data.links.map((l) => (
                <tr key={l.label} className="border-b border-white/5 last:border-b-0">
                  <td className="px-5 py-3.5 font-medium text-textPrimary">{l.label}</td>
                  <td className="px-5 py-3.5 text-textMuted">{fmtInt(l.clicks)}</td>
                  <td className="px-5 py-3.5 text-textMuted">{fmtInt(l.bookings)}</td>
                  <td className="px-5 py-3.5 text-textPrimary">${fmtUsdc(l.usdc)}</td>
                  <td className="px-5 py-3.5 text-right">
                    <CopyInline value={l.url} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Payouts */}
      <Section title="Weekly USDC payouts">
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[560px] border-collapse text-left text-[14px]">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02] text-[12px] uppercase tracking-wide text-textSecondary">
                <th className="px-5 py-3 font-semibold">Date</th>
                <th className="px-5 py-3 font-semibold">Amount</th>
                <th className="px-5 py-3 font-semibold">Chain</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold text-right">On-chain proof</th>
              </tr>
            </thead>
            <tbody>
              {data.payouts.map((p) => (
                <tr key={p.txHash} className="border-b border-white/5 last:border-b-0">
                  <td className="px-5 py-3.5 text-textMuted">{fmtDate(p.date)}</td>
                  <td className="px-5 py-3.5 font-semibold text-textPrimary">${fmtUsdc(p.amountUsdc)}</td>
                  <td className="px-5 py-3.5 text-textMuted">{p.chain}</td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        p.status === "Paid" ? "bg-neon/10 text-neon" : "bg-amber-400/10 text-amber-400"
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <a
                      href={p.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 font-mono text-[12px] text-neon hover:underline"
                    >
                      {shortHash(p.txHash)} <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px] text-textSecondary">
          Every payout is a real on-chain transfer to your wallet — click any hash to verify it on the block explorer.
        </p>
      </Section>

      {/* Discover creators — follow other creators (Furlpay-native social graph) */}
      <Section title="Discover creators">
        <div className="grid gap-3 sm:grid-cols-2">
          {OTHER_CREATORS.filter((c) => c.email.toLowerCase() !== data.email.toLowerCase()).map((c) => {
            const following = data.followingEmails.includes(c.email.toLowerCase());
            const busy = followBusy === c.email;
            return (
              <div
                key={c.email}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={c.name} size={40} />
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-textPrimary">{c.name}</p>
                    <p className="truncate text-[12px] text-textSecondary">
                      @{c.handle} · {c.audience} followers
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => toggleFollow(c.email, following)}
                  disabled={busy}
                  aria-label={following ? `Unfollow ${c.name}` : `Follow ${c.name}`}
                  className={
                    following
                      ? "flex flex-shrink-0 items-center gap-1.5 rounded-pill border border-white/15 px-4 py-2 text-[13px] font-semibold text-textPrimary transition-colors hover:border-red-400/40 hover:text-red-400 disabled:opacity-60"
                      : "flex flex-shrink-0 items-center gap-1.5 rounded-pill bg-neon px-4 py-2 text-[13px] font-semibold text-black transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
                  }
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : following ? (
                    <>
                      <UserCheck className="h-4 w-4" /> Following
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" /> Follow
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[12px] text-textSecondary">
          Follow other Furlpay creators to build your travel network. Your follow graph is native to Furlpay —
          Instagram&apos;s API doesn&apos;t expose follow lists, so this lives on-platform.
        </p>
      </Section>

      {/* Footer */}
      <div className="mt-10 flex flex-wrap items-center justify-center gap-4 border-t border-white/5 pt-6 text-[13px] text-textSecondary">
        <a href="/discord" className="hover:text-neon">Join the Discord</a>
        <span className="text-white/10">·</span>
        <Link href="/resources" className="hover:text-neon">Creator resources</Link>
        <span className="text-white/10">·</span>
        <Link href="/talk-to-us" className="hover:text-neon">Talk to us</Link>
      </div>
    </div>
  );
}

// ── Small presentational pieces ──────────────────────────────────────────────

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl border p-5 ${highlight ? "border-neon/40 bg-neon/[0.05]" : "border-white/10 bg-white/[0.02]"}`}>
      <p className="text-[12px] text-textSecondary">{label}</p>
      <p className={`mt-1.5 text-[24px] font-extrabold tracking-tight ${highlight ? "text-neon" : "text-textPrimary"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-textSecondary">{sub}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[17px] font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Progress({ label, value, target }: { label: string; value: number; target: number }) {
  const pct = Math.min(100, Math.round((value / target) * 100));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[12px]">
        <span className="text-textMuted">{label}</span>
        <span className="text-textSecondary">
          {fmtInt(value)} / {fmtInt(target)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-neon transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (v: string) => {
    await navigator.clipboard.writeText(v).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);
  return { copied, copy };
}

function CopyCard({ label, value, copyValue, mono }: { label: string; value: string; copyValue: string; mono?: boolean }) {
  const { copied, copy } = useCopy();
  return (
    <button
      onClick={() => copy(copyValue)}
      className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-left transition-colors hover:border-neon/30"
    >
      <div>
        <p className="text-[13px] text-textSecondary">{label}</p>
        <p className={`mt-1 text-[18px] font-bold text-textPrimary ${mono ? "font-mono" : ""}`}>{value}</p>
      </div>
      {copied ? <Check className="h-5 w-5 text-neon" /> : <Copy className="h-5 w-5 text-textMuted" />}
    </button>
  );
}

function CopyInline({ value }: { value: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      onClick={() => copy(value)}
      className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-neon hover:underline"
    >
      {copied ? "Copied" : "Copy link"}
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
