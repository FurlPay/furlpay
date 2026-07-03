"use client";

// Market Pulse strip — major index proxies with sparklines + a Fear & Greed
// style sentiment dial. Auto-refreshes with the quote cache window.
import { useEffect, useState } from "react";
import { getJSON } from "@/lib/api";
import { pct } from "@/components/ui";
import MiniSparkline from "@/components/MiniSparkline";

interface IndexItem {
  id: string;
  label: string;
  proxy: string;
  price: number;
  changePct: number;
  live: boolean;
}

export default function MarketIndices({ showSentiment = true }: { showSentiment?: boolean }) {
  const [data, setData] = useState<{ items: IndexItem[]; sentiment: number } | null>(null);

  useEffect(() => {
    const load = () =>
      getJSON<{ items: IndexItem[]; sentiment: number }>("/api/markets/indices").then(setData).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  if (!data) {
    return <div className="mx-5 h-[86px] animate-pulse rounded-2xl bg-white/[0.03]" />;
  }

  const s = data.sentiment;
  const mood = s >= 65 ? "Greed" : s >= 45 ? "Neutral" : "Fear";
  const moodColor = s >= 65 ? "#30D158" : s >= 45 ? "#FFD60A" : "#FF453A";

  return (
    <div className="no-scrollbar flex snap-x gap-2.5 overflow-x-auto px-5">
      {showSentiment && (
        <div className="flex w-[132px] shrink-0 snap-start flex-col justify-between surface-card p-3">
          <p className="text-[11px] text-textSecondary">Sentiment</p>
          <p className="text-[19px] font-extrabold tracking-tight" style={{ color: moodColor }}>
            {mood}
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-full rounded-full transition-all" style={{ width: `${s}%`, background: moodColor }} />
          </div>
          <p className="mt-1 text-[10px] text-textMuted">{s}/100 · index breadth</p>
        </div>
      )}
      {data.items.map((ix) => {
        const up = ix.changePct >= 0;
        return (
          <div key={ix.id} className="w-[132px] shrink-0 snap-start surface-card p-3">
            <p className="truncate text-[11px] text-textSecondary">{ix.label}</p>
            <p className="mt-0.5 text-[15px] font-bold tracking-tight">
              {ix.price >= 1000 ? ix.price.toLocaleString("en-US", { maximumFractionDigits: 0 }) : ix.price.toFixed(2)}
            </p>
            <div className="mt-1 flex items-center justify-between">
              <MiniSparkline seed={`ix-${ix.id}`} changePct={ix.changePct} width={56} height={18} />
              <span className={`text-[11px] font-semibold ${up ? "text-gain" : "text-loss"}`}>{pct(ix.changePct)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
