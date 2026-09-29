"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, TriangleAlert } from "lucide-react";

// ---------------------------------------------------------------------------
// Revenue analytics for the ops console.
//
// ── WHAT THIS SURFACE REFUSES TO DO ────────────────────────────────────────
//
// It never shows one number called "revenue" that includes volume, and it
// never shows one that includes simulated activity. Those are the two ways a
// revenue dashboard lies, and both are easy to build by accident because the
// resulting number is bigger and looks better.
//
// So TPV and revenue are separate tiles with separate labels, and simulated
// activity is rendered in a visually muted band that says what it is. A reader
// should not be able to glance at this and come away with a wrong number.
//
// Totals are per ASSET. Minor units are only comparable within an asset, so
// there is no blended "total" tile — that needs FX rates at a point in time,
// and inventing them here would be exactly the kind of silent assumption this
// module exists to prevent.
// ---------------------------------------------------------------------------

type ByAsset = Record<string, string>;

interface Totals {
  realized: ByAsset;
  pending: ByAsset;
  simulated: ByAsset;
  reversed: ByAsset;
  volume: ByAsset;
  applicableVolume: ByAsset;
  eventCount: number;
  payingUsers: number;
}

interface RevenueResponse {
  window: { days: number; from: string; to: string };
  durable: boolean;
  totals: Totals;
  netRealized: ByAsset;
  takeRateBps: Record<string, number | null>;
  arpuMinor: ByAsset;
  growthPct: Record<string, number | null>;
  byEngine: Record<string, Totals>;
  bySource: Record<string, Totals>;
  byDay: Record<string, Totals>;
}

/** Minor units are asset-specific; only these need formatting so far. */
const DECIMALS: Record<string, number> = {
  USD: 2, EUR: 2, GBP: 2, INR: 2,
  "USDC.ethereum": 6, "USDC.arbitrum": 6, "USDC.base": 6,
  "USDC.polygon": 6, "USDC.solana": 6, "USDC.tempo": 6, "USDC.arc": 18,
};

/** Format minor units without going through a float. */
function fromMinor(minorUnits: string, asset: string): string {
  const decimals = DECIMALS[asset] ?? 2;
  const negative = minorUnits.startsWith("-");
  const digits = (negative ? minorUnits.slice(1) : minorUnits).padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals) || "0";
  const frac = decimals ? digits.slice(digits.length - decimals) : "";
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  // Long fractions (18-decimal assets) are trimmed for display only.
  const shown = frac ? `.${frac.slice(0, Math.min(decimals, 6))}` : "";
  return `${negative ? "-" : ""}${grouped}${shown}`;
}

function assetLabel(asset: string): string {
  return asset.includes(".") ? asset.split(".")[0] : asset;
}

/** Render a per-asset map as lines, or a dash when empty. */
function AssetLines({ map, empty = "—" }: { map: ByAsset; empty?: string }) {
  const entries = Object.entries(map).filter(([, v]) => v !== "0");
  if (!entries.length) return <span className="text-white/40">{empty}</span>;
  return (
    <span className="flex flex-col gap-0.5">
      {entries.map(([asset, v]) => (
        <span key={asset}>
          {fromMinor(v, asset)}{" "}
          <span className="text-[11px] font-normal text-white/45">{assetLabel(asset)}</span>
        </span>
      ))}
    </span>
  );
}

function Tile({
  label,
  children,
  hint,
  tone = "default",
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  tone?: "default" | "muted";
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        tone === "muted"
          ? "border-white/[0.08] bg-white/[0.015]"
          : "border-white/10 bg-white/[0.035]"
      }`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
        {label}
      </div>
      <div
        className={`mt-2 text-[19px] font-semibold ${
          tone === "muted" ? "text-white/55" : "text-white"
        }`}
      >
        {children}
      </div>
      {hint ? <div className="mt-1 text-[11px] text-white/40">{hint}</div> : null}
    </div>
  );
}

const RANGES = [7, 30, 90] as const;

export default function RevenuePanel() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<RevenueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (range: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/revenue?days=${range}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData((json.data ?? json) as RevenueResponse);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const rate = data ? Object.entries(data.takeRateBps).filter(([, v]) => v != null) : [];
  const engines = data
    ? Object.entries(data.byEngine).filter(
        ([, t]) => Object.keys(t.realized).length || Object.keys(t.simulated).length,
      )
    : [];

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] shadow-[0_20px_60px_-40px_rgba(0,0,0,0.9)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="h-4 w-4" />
          Revenue
        </div>
        <div className="flex items-center gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setDays(r)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                days === r
                  ? "bg-white/15 text-white"
                  : "text-white/50 hover:bg-white/[0.06] hover:text-white/80"
              }`}
            >
              {r}d
            </button>
          ))}
        </div>
      </header>

      <div className="p-4">
        {error ? (
          <p className="text-sm text-red-300">Could not load revenue: {error}</p>
        ) : !data ? (
          <p className="text-sm text-white/45">{loading ? "Loading…" : "No data."}</p>
        ) : (
          <>
            {!data.durable && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-400/35 bg-amber-400/10 p-3 text-xs text-amber-200">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  No database configured — these events live in this instance&apos;s memory and
                  disappear on restart. Apply migration 0018 and configure Supabase for a durable
                  record.
                </span>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Tile label="Realized revenue" hint="net of reversals — what we kept">
                <AssetLines map={data.netRealized} empty="0" />
              </Tile>
              <Tile label="TPV" hint="gross value that moved — NOT revenue">
                <AssetLines map={data.totals.volume} empty="0" />
              </Tile>
              <Tile label="Effective take rate" hint="realized ÷ applicable volume">
                {rate.length ? (
                  <span className="flex flex-col gap-0.5">
                    {rate.map(([asset, bps]) => (
                      <span key={asset}>
                        {bps} bps{" "}
                        <span className="text-[11px] font-normal text-white/45">
                          {assetLabel(asset)}
                        </span>
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-white/40">—</span>
                )}
              </Tile>
              <Tile label="Paying accounts" hint={`${data.totals.eventCount} events in window`}>
                {data.totals.payingUsers.toLocaleString()}
              </Tile>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Tile label="Pending" hint="earned, not yet collected" tone="muted">
                <AssetLines map={data.totals.pending} empty="0" />
              </Tile>
              <Tile label="Simulated" hint="pre-licence paths — never revenue" tone="muted">
                <AssetLines map={data.totals.simulated} empty="0" />
              </Tile>
              <Tile label="Reversed" hint="refunds and chargebacks" tone="muted">
                <AssetLines map={data.totals.reversed} empty="0" />
              </Tile>
            </div>

            <div className="mt-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                By engine
              </h3>
              {engines.length ? (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="text-[11px] uppercase tracking-wider text-white/40">
                      <tr>
                        <th className="px-3 py-2 font-medium">Engine</th>
                        <th className="px-3 py-2 font-medium">Realized</th>
                        <th className="px-3 py-2 font-medium">Simulated</th>
                        <th className="px-3 py-2 font-medium">Volume</th>
                        <th className="px-3 py-2 font-medium">Events</th>
                      </tr>
                    </thead>
                    <tbody>
                      {engines.map(([engine, t]) => (
                        <tr key={engine}>
                          <td className="border-b border-white/[0.06] px-3 py-3 font-medium capitalize">
                            {engine}
                          </td>
                          <td className="border-b border-white/[0.06] px-3 py-3">
                            <AssetLines map={t.realized} empty="0" />
                          </td>
                          <td className="border-b border-white/[0.06] px-3 py-3 text-white/55">
                            <AssetLines map={t.simulated} empty="0" />
                          </td>
                          <td className="border-b border-white/[0.06] px-3 py-3 text-white/70">
                            <AssetLines map={t.volume} empty="0" />
                          </td>
                          <td className="border-b border-white/[0.06] px-3 py-3 text-white/70">
                            {t.eventCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-2 text-sm text-white/45">
                  No revenue events in this window. Engines emit events as their real integrations
                  land — see docs/REVENUE.md for which are live and which are blocked.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
