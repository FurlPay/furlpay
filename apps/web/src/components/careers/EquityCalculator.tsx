"use client";

import { useState } from "react";

// Transparent comp modeling — the bands mirror the published "How we pay"
// policy (70–85% of US remote market, 0.05–3% equity). The exit math applies
// a flat 20% dilution assumption and says so; this is a model, not an offer.

const DILUTION = 0.2;

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function EquityCalculator() {
  const [salary, setSalary] = useState(140_000);
  const [equity, setEquity] = useState(0.75);
  const [exitValuation, setExitValuation] = useState(100_000_000);

  const equityAtExit = exitValuation * (equity / 100) * (1 - DILUTION);

  return (
    <div className="glass-card p-6">
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-5">
          <div>
            <label className="flex justify-between text-[13px] text-textSecondary">
              <span>Base salary</span>
              <span className="font-semibold text-white">{usd(salary)} / yr</span>
            </label>
            <input
              type="range"
              min={60_000}
              max={220_000}
              step={5_000}
              value={salary}
              onChange={(e) => setSalary(Number(e.target.value))}
              className="mt-1.5 w-full accent-neon"
              aria-label="Base salary"
            />
          </div>
          <div>
            <label className="flex justify-between text-[13px] text-textSecondary">
              <span>Equity grant</span>
              <span className="font-semibold text-white">{equity.toFixed(2)}%</span>
            </label>
            <input
              type="range"
              min={0.05}
              max={3}
              step={0.05}
              value={equity}
              onChange={(e) => setEquity(Number(e.target.value))}
              className="mt-1.5 w-full accent-neon"
              aria-label="Equity grant percentage"
            />
          </div>
          <div>
            <label className="flex justify-between text-[13px] text-textSecondary">
              <span>Exit valuation (model)</span>
              <span className="font-semibold text-white">{usd(exitValuation)}</span>
            </label>
            <input
              type="range"
              min={10_000_000}
              max={500_000_000}
              step={10_000_000}
              value={exitValuation}
              onChange={(e) => setExitValuation(Number(e.target.value))}
              className="mt-1.5 w-full accent-neon"
              aria-label="Modeled exit valuation"
            />
          </div>
        </div>

        <div className="flex flex-col justify-center border-white/10 lg:border-l lg:pl-8">
          <p className="text-[13px] text-textSecondary">Modeled equity value at exit</p>
          <p className="mt-1 text-[34px] font-extrabold tracking-tighter text-neon">{usd(equityAtExit)}</p>
          <p className="mt-2 text-[13px] leading-relaxed text-textMuted">
            {equity.toFixed(2)}% of {usd(exitValuation)}, after an assumed {DILUTION * 100}% dilution
            across future rounds. Four-year vest, one-year cliff. A model for thinking, not an offer —
            real numbers are on the table in the final round.
          </p>
        </div>
      </div>
    </div>
  );
}
