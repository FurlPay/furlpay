"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, BellRing, Plane, Hotel, Trash2, Zap, ArrowLeft, Target } from "lucide-react";
import { Pill } from "@/components/ui";
import type { PriceAlert, SuccessBand } from "@/lib/travel/alerts";

// Price alerts — watch a flight route or hotel city, set a target price, and
// see a color-coded success rate. With auto-book on, the booking settles from
// the USDC balance the moment the target is hit (zero-touch travel).

const BAND_META: Record<SuccessBand, { label: string; dot: string; bar: string; text: string }> = {
  high: { label: "High chance", dot: "bg-emerald-400", bar: "bg-emerald-400", text: "text-emerald-400" },
  medium: { label: "Medium chance", dot: "bg-amber-400", bar: "bg-amber-400", text: "text-amber-400" },
  low: { label: "Low chance", dot: "bg-rose-400", bar: "bg-rose-400", text: "text-rose-400" },
};

export default function PriceAlertsPage() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [kind, setKind] = useState<"flight" | "hotel">("flight");
  const [from, setFrom] = useState("DEL");
  const [to, setTo] = useState("");
  const [date, setDate] = useState(() => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const [target, setTarget] = useState("");
  const [autoBook, setAutoBook] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Set when the server refuses the feature (production: no price monitor yet). */
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const load = () =>
    fetch("/api/travel/alerts")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        // 503 not_available: the route is switched off on this deployment. Say so
        // up front instead of letting someone fill in a form that cannot work.
        if (r.status === 503 && d?.error === "not_available") {
          setUnavailable(typeof d.detail === "string" ? d.detail : "Price alerts are not available yet.");
          return;
        }
        setAlerts(d.alerts ?? []);
      })
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const canSubmit = useMemo(
    () => to.trim().length > 0 && Number(target) > 0 && !busy,
    [to, target, busy],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/travel/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, from, to, date, targetUsd: Number(target), autoBook }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      setTo("");
      setTarget("");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/travel/alerts?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    setAlerts((a) => a.filter((x) => x.id !== id));
  }

  return (
    <div className="mx-auto max-w-4xl px-5 pb-24 pt-8">
      <Link href="/travel" className="mb-4 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Travels
      </Link>

      <div className="mb-3 flex items-center gap-2">
        <Pill tone="accent">Price Alerts</Pill>
        <span className="text-xs text-textSecondary">Watch fares · auto-book in USDC</span>
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-white">
        Name your price. <span className="text-neon">We&apos;ll catch the dip.</span>
      </h1>
      <p className="mt-2 max-w-xl text-sm text-textSecondary">
        Set a target price on any flight route or hotel city. We track fares continuously, show you the
        odds of hitting your target — and with auto-book on, settle the booking from your USDC balance
        the second the price lands. No credits, no vouchers, no 2am fare-watching.
      </p>

      {unavailable && (
        <div role="status" className="mt-6 rounded-card border border-amber-400/25 bg-amber-400/[0.06] px-5 py-4 text-sm text-amber-100">
          <p className="font-semibold">{unavailable}</p>
          <p className="mt-1 text-amber-100/70">
            There is no price monitor behind alerts on this deployment, so we do not take any — nothing would watch the fare or book it.
          </p>
        </div>
      )}

      {/* Create alert */}
      <form onSubmit={submit} className="mt-8 rounded-card border border-white/10 bg-charcoal p-5">
        <fieldset disabled={!!unavailable} className="contents">
        <div className="mb-4 flex gap-2">
          {(["flight", "hotel"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                kind === k ? "bg-neon text-black" : "border border-white/15 text-textSecondary hover:text-white"
              }`}
            >
              {k === "flight" ? <Plane className="h-4 w-4" /> : <Hotel className="h-4 w-4" />}
              {k === "flight" ? "Flight" : "Hotel"}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {kind === "flight" && (
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-textMuted">From (IATA)</span>
              <input
                value={from}
                onChange={(e) => setFrom(e.target.value.toUpperCase())}
                maxLength={3}
                placeholder="DEL"
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-neon/60"
              />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-textMuted">
              {kind === "flight" ? "To (IATA)" : "City"}
            </span>
            <input
              value={to}
              onChange={(e) => setTo(kind === "flight" ? e.target.value.toUpperCase() : e.target.value)}
              maxLength={kind === "flight" ? 3 : 40}
              placeholder={kind === "flight" ? "LHR" : "Tokyo"}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-neon/60"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-textMuted">
              {kind === "flight" ? "Travel date" : "Check-in"}
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-neon/60"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-textMuted">
              Target price (USD{kind === "hotel" ? "/night" : ""})
            </span>
            <input
              type="number"
              min={1}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="320"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-neon/60"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setAutoBook((v) => !v)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              autoBook
                ? "border-neon/50 bg-neon/10 text-neon"
                : "border-white/15 text-textSecondary hover:text-white"
            }`}
          >
            <Zap className="h-3.5 w-3.5" />
            Auto-book from USDC balance {autoBook ? "on" : "off"}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex items-center gap-2 rounded-lg bg-neon px-4 py-2 text-sm font-bold text-black transition hover:bg-neon/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Bell className="h-4 w-4" /> {busy ? "Creating…" : "Create alert"}
          </button>
        </div>
        {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
        <p className="mt-3 text-[11px] text-textMuted">
          Auto-book uses your saved traveler profile and a spending cap you approve once. Refunds on
          cancellation return as USDC cash to your wallet — never platform credit.
        </p>
        </fieldset>
      </form>

      {/* Alert list */}
      <section className="mt-10">
        <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-white">
          <BellRing className="h-5 w-5 text-neon" /> Watching {alerts.length > 0 && `(${alerts.length})`}
        </h2>
        {alerts.length === 0 && (
          <p className="rounded-card border border-dashed border-white/10 p-8 text-center text-sm text-textSecondary">
            No alerts yet. Create one above — green means your target is realistic, red means it&apos;s a
            long shot.
          </p>
        )}
        <div className="space-y-3">
          {alerts.map((a) => {
            const meta = BAND_META[a.band];
            const triggered = a.status === "triggered";
            return (
              <div key={a.id} className="rounded-card border border-white/10 bg-charcoal p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-neon/15 text-neon">
                      {a.kind === "flight" ? <Plane className="h-4 w-4" /> : <Hotel className="h-4 w-4" />}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {a.kind === "flight" ? `${a.from} → ${a.to}` : a.to}
                        {a.autoBook && (
                          <span className="ml-2 rounded-full bg-neon/15 px-2 py-0.5 text-[10px] font-bold text-neon">
                            AUTO-BOOK
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-textSecondary">
                        {a.date} · target ${a.targetUsd.toFixed(0)} · now ${a.currentUsd.toFixed(0)}
                        {a.kind === "hotel" && "/night"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {triggered ? (
                      <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                        <Target className="h-4 w-4" /> Target hit — ready to book
                      </span>
                    ) : (
                      <div className="w-40">
                        <div className="mb-1 flex items-center justify-between text-[11px]">
                          <span className={`flex items-center gap-1 font-semibold ${meta.text}`}>
                            <span className={`h-2 w-2 rounded-full ${meta.dot}`} /> {meta.label}
                          </span>
                          <span className="font-mono text-textSecondary">{a.successPct}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${a.successPct}%` }} />
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => remove(a.id)}
                      aria-label="Delete alert"
                      className="rounded-lg border border-white/10 p-2 text-textSecondary transition hover:border-rose-400/40 hover:text-rose-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <p className="mt-8 text-[11px] text-textMuted">
        Success rates are modeled from historical fare distributions and days remaining before travel.
        They are estimates, not guarantees. Fares refresh continuously; alert notifications arrive by
        push and email.
      </p>
    </div>
  );
}
