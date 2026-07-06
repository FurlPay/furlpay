"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

// Enterprise ROI calculator — richer than the fee calculator. Adds an
// international-mix input (cards charge extra FX/cross-border on those) and
// surfaces the non-fee wins: settlement speed and chargeback elimination.
// All numbers are transparent and labelled as estimates.

const FURLPAY_RATE = 0.005; // 0.5%
const CARD_DOMESTIC = 0.029; // 2.9%
const CARD_INTL_EXTRA = 0.015; // +1.5% cross-border + FX on international cards
const CARD_PER_TX = 0.3; // $0.30 fixed
const CHARGEBACK_RATE = 0.006; // ~0.6% of volume lost to chargebacks + fees (illustrative)

function usd(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function RoiCalculator() {
  const [volume, setVolume] = useState(500000); // annual $ volume
  const [avgTicket, setAvgTicket] = useState(120);
  const [intlPct, setIntlPct] = useState(40); // % of volume from international cards

  const r = useMemo(() => {
    const txCount = avgTicket > 0 ? volume / avgTicket : 0;
    const intl = Math.min(Math.max(intlPct, 0), 100) / 100;
    const cardPct = CARD_DOMESTIC + CARD_INTL_EXTRA * intl;
    const cardFees = volume * cardPct + txCount * CARD_PER_TX;
    const chargebacks = volume * CHARGEBACK_RATE;
    const furlCost = volume * FURLPAY_RATE;
    const feeSavings = Math.max(0, cardFees - furlCost);
    const totalSavings = feeSavings + chargebacks; // chargebacks eliminated on-chain
    return {
      cardFees,
      chargebacks,
      furlCost,
      feeSavings,
      totalSavings,
      effCardRate: volume > 0 ? cardFees / volume : 0,
    };
  }, [volume, avgTicket, intlPct]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 sm:p-8">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Field label="Annual payment volume" value={volume} onChange={setVolume} prefix="$" min={0} rangeMax={5000000} step={10000} />
          <Field label="Average transaction size" value={avgTicket} onChange={setAvgTicket} prefix="$" min={1} rangeMax={2000} step={5} />
          <label className="block">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-textSecondary">International customers</span>
              <span className="text-[13px] font-bold text-neon">{intlPct}%</span>
            </div>
            <input type="range" min={0} max={100} step={5} value={intlPct} onChange={(e) => setIntlPct(Number(e.target.value))} className="mt-3 w-full accent-neon" />
            <p className="mt-1 text-[11px] text-textMuted">Cards add cross-border + FX fees on these — USDC does not.</p>
          </label>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-neon/20 bg-neon/[0.04] p-6">
          <div className="space-y-3">
            <Row label="Card fees (incl. FX)" value={usd(r.cardFees)} muted />
            <Row label="Chargeback cost (est.)" value={usd(r.chargebacks)} muted />
            <Row label="Furlpay (USDC, 0.5%)" value={usd(r.furlCost)} accent />
            <div className="h-px bg-white/10" />
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wider text-textMuted">Estimated annual saving</p>
              <p className="mt-1 text-[34px] font-extrabold leading-none tracking-tighter text-neon">{usd(r.totalSavings)}</p>
              <p className="mt-1 text-[12px] text-textSecondary">
                {usd(r.feeSavings)} fees + {usd(r.chargebacks)} chargebacks avoided
              </p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 text-center text-[11px] text-textSecondary">
            <div className="rounded-lg border border-white/10 p-2"><span className="block text-[15px] font-bold text-white">~1 sec</span>settlement vs 2–3 days</div>
            <div className="rounded-lg border border-white/10 p-2"><span className="block text-[15px] font-bold text-white">0</span>chargebacks (final)</div>
          </div>
          <Link href="/talk-to-us" className="btn-green mt-4 w-full py-3 text-center text-[15px]">Talk to sales</Link>
        </div>
      </div>
      <p className="mt-5 text-[11px] leading-relaxed text-textMuted">
        Estimates only. Card cost = 2.9% domestic + 1.5% extra on the international share + $0.30/tx;
        chargeback cost is an illustrative 0.6% of volume; actual figures vary by business. Furlpay is
        0.5% plus sub-cent Arbitrum gas. Not a guarantee of savings.
      </p>
    </div>
  );
}

function Field({ label, value, onChange, prefix, min, rangeMax, step }: { label: string; value: number; onChange: (n: number) => void; prefix: string; min: number; rangeMax: number; step: number }) {
  return (
    <label className="block">
      <span className="text-[13px] font-semibold text-textSecondary">{label}</span>
      <div className="mt-2 flex items-center rounded-xl border border-white/10 bg-black/40 px-4 py-3">
        <span className="text-textMuted">{prefix}</span>
        <input type="number" min={min} value={value} onChange={(e) => onChange(Math.max(min, Number(e.target.value)))} className="w-full bg-transparent pl-2 text-[18px] font-bold outline-none" />
      </div>
      <input type="range" min={min} max={rangeMax} step={step} value={Math.min(value, rangeMax)} onChange={(e) => onChange(Number(e.target.value))} className="mt-3 w-full accent-neon" />
    </label>
  );
}

function Row({ label, value, accent, muted }: { label: string; value: string; accent?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[13px] text-textSecondary">{label}</span>
      <span className={`text-[17px] font-bold ${accent ? "text-neon" : muted ? "text-textSecondary" : ""}`}>{value}</span>
    </div>
  );
}
