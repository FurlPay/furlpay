"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

// Interactive card-vs-stablecoin fee savings calculator. Used standalone on
// /resources/tools/fee-calculator and embedded (compact) on the homepage.
// Numbers are transparent: card cost = rate% + per-tx fee; Furlpay = 0.5% flat
// plus a fraction of a cent of Arbitrum gas (negligible, shown as a footnote).

const FURLPAY_RATE = 0.005; // 0.5%

const CARD_PRESETS = [
  { label: "Stripe (2.9% + 30¢)", rate: 0.029, perTx: 0.3 },
  { label: "Typical card (3.5%)", rate: 0.035, perTx: 0 },
  { label: "Amex / premium (3.5% + 15¢)", rate: 0.035, perTx: 0.15 },
] as const;

function usd(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function FeeCalculator({ compact = false }: { compact?: boolean }) {
  const [volume, setVolume] = useState(50000); // monthly $ volume
  const [avgTicket, setAvgTicket] = useState(75); // avg transaction size (drives per-tx fees)
  const [presetIdx, setPresetIdx] = useState(0);

  const r = useMemo(() => {
    const preset = CARD_PRESETS[presetIdx];
    const txCount = avgTicket > 0 ? volume / avgTicket : 0;
    const cardCost = volume * preset.rate + txCount * preset.perTx;
    const furlCost = volume * FURLPAY_RATE;
    const monthlySavings = Math.max(0, cardCost - furlCost);
    return {
      cardCost,
      furlCost,
      monthlySavings,
      annualSavings: monthlySavings * 12,
      effectiveCardRate: volume > 0 ? cardCost / volume : 0,
    };
  }, [volume, avgTicket, presetIdx]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 sm:p-8">
      <div className="grid gap-6 sm:grid-cols-2">
        {/* Inputs */}
        <div className="space-y-6">
          <label className="block">
            <span className="text-[13px] font-semibold text-textSecondary">Monthly payment volume</span>
            <div className="mt-2 flex items-center rounded-xl border border-white/10 bg-black/40 px-4 py-3">
              <span className="text-textMuted">$</span>
              <input
                type="number"
                min={0}
                value={volume}
                onChange={(e) => setVolume(Math.max(0, Number(e.target.value)))}
                className="w-full bg-transparent pl-2 text-[18px] font-bold outline-none"
              />
            </div>
            <input
              type="range"
              min={1000}
              max={1000000}
              step={1000}
              value={Math.min(volume, 1000000)}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="mt-3 w-full accent-neon"
            />
          </label>

          <label className="block">
            <span className="text-[13px] font-semibold text-textSecondary">Average transaction size</span>
            <div className="mt-2 flex items-center rounded-xl border border-white/10 bg-black/40 px-4 py-3">
              <span className="text-textMuted">$</span>
              <input
                type="number"
                min={1}
                value={avgTicket}
                onChange={(e) => setAvgTicket(Math.max(1, Number(e.target.value)))}
                className="w-full bg-transparent pl-2 text-[18px] font-bold outline-none"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-[13px] font-semibold text-textSecondary">Compare against</span>
            <select
              value={presetIdx}
              onChange={(e) => setPresetIdx(Number(e.target.value))}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-[15px] outline-none"
            >
              {CARD_PRESETS.map((p, i) => (
                <option key={p.label} value={i} className="bg-black">
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Results */}
        <div className="flex flex-col justify-between rounded-xl border border-neon/20 bg-neon/[0.04] p-6">
          <div className="space-y-4">
            <Row label="Card processing fees" value={usd(r.cardCost)} sub="per month" muted />
            <Row label="Furlpay (USDC, 0.5%)" value={usd(r.furlCost)} sub="per month" accent />
            <div className="h-px bg-white/10" />
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wider text-textMuted">
                You save
              </p>
              <p className="mt-1 text-[34px] font-extrabold leading-none tracking-tighter text-neon">
                {usd(r.annualSavings)}
                <span className="ml-2 text-[14px] font-semibold text-textSecondary">/ year</span>
              </p>
              <p className="mt-1 text-[13px] text-textSecondary">{usd(r.monthlySavings)} every month</p>
            </div>
          </div>
          {!compact && (
            <Link href="/signup" className="btn-green mt-6 w-full py-3 text-center text-[15px]">
              Start saving — 0.5% flat
            </Link>
          )}
        </div>
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-textMuted">
        Estimates only. Card cost = selected rate × volume + per-transaction fee × (volume ÷ average
        ticket); actual card pricing varies by issuer, category and geography. Furlpay is 0.5% plus
        roughly $0.001–$0.005 of Arbitrum gas per payment (excluded above as negligible). Live quotes:{" "}
        <a href="/api/payments/fees/estimate?amount=150" className="text-neon">
          /api/payments/fees/estimate
        </a>
        .
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  sub,
  accent,
  muted,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[13px] text-textSecondary">{label}</span>
      <span className="text-right">
        <span
          className={`text-[18px] font-bold ${accent ? "text-neon" : muted ? "text-textSecondary" : ""}`}
        >
          {value}
        </span>
        <span className="ml-1.5 text-[11px] text-textMuted">{sub}</span>
      </span>
    </div>
  );
}
