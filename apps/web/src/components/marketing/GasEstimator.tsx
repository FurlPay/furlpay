"use client";

import { useMemo, useState } from "react";

// Gas cost estimator — how much network fee you'd pay to settle N payments on
// each chain. Rates are illustrative typical per-transfer costs (USDC ERC-20
// transfer), not live quotes; labelled as estimates. Arbitrum is Furlpay's rail.

const CHAINS: { name: string; perTx: number; note: string; highlight?: boolean }[] = [
  { name: "Arbitrum One", perTx: 0.003, note: "Furlpay's settlement rail", highlight: true },
  { name: "Base", perTx: 0.005, note: "Ethereum L2" },
  { name: "Polygon PoS", perTx: 0.01, note: "Sidechain" },
  { name: "Solana", perTx: 0.0008, note: "High-throughput L1" },
  { name: "Ethereum mainnet", perTx: 1.5, note: "L1 — highly variable" },
];

function usd(n: number) {
  return n < 1
    ? `$${n.toFixed(n < 0.01 ? 4 : 3)}`
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export default function GasEstimator() {
  const [perMonth, setPerMonth] = useState(10000);

  const rows = useMemo(() => {
    return CHAINS.map((c) => ({
      ...c,
      monthly: c.perTx * perMonth,
      annual: c.perTx * perMonth * 12,
    }));
  }, [perMonth]);

  const eth = rows.find((r) => r.name === "Ethereum mainnet")!;
  const arb = rows.find((r) => r.highlight)!;
  const savedVsEth = Math.max(0, eth.annual - arb.annual);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 sm:p-8">
      <label className="block max-w-md">
        <span className="text-[13px] font-semibold text-textSecondary">Payments per month</span>
        <div className="mt-2 flex items-center rounded-xl border border-white/10 bg-black/40 px-4 py-3">
          <input type="number" min={0} value={perMonth} onChange={(e) => setPerMonth(Math.max(0, Number(e.target.value)))} className="w-full bg-transparent text-[18px] font-bold outline-none" />
          <span className="text-[13px] text-textMuted">/mo</span>
        </div>
        <input type="range" min={100} max={1000000} step={100} value={Math.min(perMonth, 1000000)} onChange={(e) => setPerMonth(Number(e.target.value))} className="mt-3 w-full accent-neon" />
      </label>

      <div className="mt-6 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[420px] text-left text-[14px]">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.03] text-textSecondary">
              <th className="px-4 py-3 font-semibold">Chain</th>
              <th className="px-4 py-3 font-semibold">Per payment</th>
              <th className="px-4 py-3 font-semibold">Monthly</th>
              <th className="px-4 py-3 font-semibold">Annual</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {rows.map((r) => (
              <tr key={r.name} className={r.highlight ? "bg-neon/[0.05]" : ""}>
                <td className="px-4 py-3">
                  <span className={`font-semibold ${r.highlight ? "text-neon" : ""}`}>{r.name}</span>
                  <span className="block text-[11px] text-textMuted">{r.note}</span>
                </td>
                <td className="px-4 py-3 text-textSecondary">{usd(r.perTx)}</td>
                <td className="px-4 py-3 text-textSecondary">{usd(r.monthly)}</td>
                <td className={`px-4 py-3 font-semibold ${r.highlight ? "text-neon" : ""}`}>{usd(r.annual)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-5 text-[13px] text-textSecondary">
        Settling on <span className="font-semibold text-neon">Arbitrum</span> instead of Ethereum
        mainnet saves roughly <span className="font-semibold text-white">{usd(savedVsEth)}</span> a
        year in gas at this volume.
      </p>
      <p className="mt-3 text-[11px] leading-relaxed text-textMuted">
        Illustrative estimates for a USDC transfer, not live quotes. Ethereum mainnet gas is highly
        variable and can be far higher at peak. Furlpay can also sponsor Arbitrum gas via a paymaster,
        so end users may pay nothing.
      </p>
    </div>
  );
}
