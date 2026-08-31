"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/components/auth/SessionProvider";
import { usd } from "@/components/ui";
import Sparkline from "./Sparkline";
import { fmtPctSigned } from "./format";

// ---------------------------------------------------------------------------
// Portfolio Snapshot — the middle panel of the intelligence rail.
//
// Reads the EXISTING /api/investing/portfolio, which projects holdings from the
// trade-lot ledger. Nothing is computed here that the API does not return.
//
// THE CHART. The reference composition shows a rising portfolio curve, and this
// panel does not draw one, because there is no portfolio time series in this
// codebase — no daily snapshot table, no valuation history. The only honest
// series available is today's move, which is a single number, and a line drawn
// through one point is an invention. So the panel shows the value, the real
// day change, and a per-holding allocation bar built from actual market values.
//
// Four states, all real:
//   signed out    an invitation, no numbers
//   loading       skeleton
//   empty         a signed-in user who holds nothing — says so, offers Markets
//   funded        value, day change, allocation
// ---------------------------------------------------------------------------

interface Holding {
  symbol: string;
  marketValue: number;
  changePct: number;
}

interface PortfolioResponse {
  holdings: Holding[];
  performance: {
    marketValue: number;
    dayChange: number;
    dayChangePct: number;
  };
}

/** Allocation bar colours. Fixed rotation, so a holding keeps its colour
 *  between renders instead of shuffling on every refetch. */
const SLICE_COLORS = ["#22D3EE", "#8B5CF6", "#34D399", "#FBBF24", "#F87171", "#64748B"];

export default function PortfolioSnapshot() {
  const { status } = useSession();
  const pathname = usePathname();
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (status !== "authenticated") {
      setData(null);
      setState("idle");
      return;
    }
    let cancelled = false;
    setState("loading");

    fetch("/api/investing/portfolio", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<PortfolioResponse>) : Promise.reject(r.status)))
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [status]);

  const slices = useMemo(() => {
    const holdings = data?.holdings ?? [];
    const total = holdings.reduce((s, h) => s + h.marketValue, 0);
    if (total <= 0) return [];
    return [...holdings]
      .sort((a, b) => b.marketValue - a.marketValue)
      .slice(0, 6)
      .map((h, i) => ({
        symbol: h.symbol,
        pct: (h.marketValue / total) * 100,
        color: SLICE_COLORS[i % SLICE_COLORS.length],
      }));
  }, [data]);

  const signInHref = `/login?next=${encodeURIComponent(pathname || "/markets")}`;

  return (
    <section className="surface-card p-3.5" aria-labelledby="portfolio-heading">
      <h2 id="portfolio-heading" className="text-[13.5px] font-bold text-white">
        Portfolio Snapshot
      </h2>

      {status !== "authenticated" ? (
        <>
          <p className="mt-2 text-[11.5px] leading-relaxed text-textSecondary">
            Track your portfolio in one place. Sign in to see your holdings and performance.
          </p>
          <Link
            href={signInHref}
            className="mt-3 block w-full rounded-lg bg-accent py-2 text-center text-[12px] font-bold text-[#04202a] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Sign In
          </Link>
        </>
      ) : state === "loading" || state === "idle" ? (
        <div className="mt-3 space-y-2" aria-hidden>
          <div className="h-7 w-32 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-4 w-20 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-2 animate-pulse rounded-full bg-white/[0.06]" />
        </div>
      ) : state === "error" ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-textSecondary">
          We could not load your portfolio just now.{" "}
          <Link href="/portfolio" className="font-semibold text-accent hover:underline">
            Open Portfolio →
          </Link>
        </p>
      ) : !data || data.performance.marketValue <= 0 ? (
        <>
          <p className="mt-2 text-[11.5px] leading-relaxed text-textSecondary">
            You don&apos;t hold any assets yet. Anything you buy will appear here.
          </p>
          <Link
            href="/portfolio"
            className="mt-3 block w-full rounded-lg border border-white/[0.1] py-2 text-center text-[12px] font-semibold text-white transition-colors hover:border-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            View Portfolio
          </Link>
        </>
      ) : (
        <>
          <p className="mt-2.5 text-[11px] text-textMuted">Total Value</p>
          <p className="text-[22px] font-bold tracking-tight text-white font-mono">
            {usd(data.performance.marketValue)}
          </p>

          <p
            className={`mt-0.5 text-[12px] font-semibold font-mono ${
              data.performance.dayChange >= 0 ? "text-gain" : "text-loss"
            }`}
          >
            {fmtPctSigned(data.performance.dayChangePct)}{" "}
            <span className="text-textMuted">
              ({data.performance.dayChange >= 0 ? "+" : ""}
              {usd(data.performance.dayChange)} today)
            </span>
          </p>

          {slices.length > 0 && (
            <>
              {/* Allocation, not a price history. Every segment is a real
                  market value as a share of the real total. */}
              <div
                className="mt-3.5 flex h-2 w-full overflow-hidden rounded-full bg-white/[0.05]"
                role="img"
                aria-label={`Allocation: ${slices
                  .map((s) => `${s.symbol} ${s.pct.toFixed(0)}%`)
                  .join(", ")}`}
              >
                {slices.map((s) => (
                  <span
                    key={s.symbol}
                    style={{ width: `${s.pct}%`, backgroundColor: s.color }}
                    className="h-full"
                  />
                ))}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-2.5 gap-y-1">
                {slices.slice(0, 4).map((s) => (
                  <li key={s.symbol} className="flex items-center gap-1 text-[10.5px] text-textSecondary">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: s.color }}
                      aria-hidden
                    />
                    {s.symbol}
                    <span className="text-textMuted font-mono">{s.pct.toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <Link
            href="/portfolio"
            className="mt-3.5 block w-full rounded-lg border border-white/[0.1] py-2 text-center text-[12px] font-semibold text-white transition-colors hover:border-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            View Portfolio
          </Link>
        </>
      )}
    </section>
  );
}
