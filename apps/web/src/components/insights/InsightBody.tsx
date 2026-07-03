import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { InsightBlock, SectorPerf } from "@/lib/insights/articles";
import type { Block } from "@/lib/blog/posts";
import { bySymbol, assetLogoPath } from "@/lib/markets/catalog";
import { getQuotes, type Quote } from "@/lib/markets/quotes";
import { AssetLogo } from "@furlpay/ui";
import SignalBadge from "./SignalBadge";
import EarningsTable from "./EarningsTable";

// Article body renderer — standard editorial blocks (blog pattern) plus the
// insight-specific blocks: earnings tables, stock cards, price targets and
// sector heatmaps. Server component: quotes resolve once per render/ISR.
export default async function InsightBody({ blocks }: { blocks: InsightBlock[] }) {
  const quotes = await getQuotes().catch(() => new Map<string, Quote>());
  return (
    <div>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} quotes={quotes} />
      ))}
    </div>
  );
}

function BlockView({ block, quotes }: { block: InsightBlock; quotes: Map<string, Quote> }) {
  switch (block.type) {
    case "h2":
      return <h2 className="mb-3 mt-10 text-[22px] font-bold tracking-tighter text-textPrimary">{block.text}</h2>;
    case "p":
      return <p className="mb-4 text-[15px] leading-relaxed text-textMuted">{block.text}</p>;
    case "ul":
      return (
        <ul className="mb-4 space-y-2 text-[15px] leading-relaxed text-textMuted">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-neon/70" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    case "code":
      return (
        <div className="mb-6 overflow-hidden rounded-xl border border-white/10 bg-[#0A0A0C]">
          <div className="border-b border-white/5 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-textSecondary">
            {(block as Extract<Block, { type: "code" }>).lang}
          </div>
          <pre className="overflow-x-auto px-4 py-4 text-[13px] leading-relaxed">
            <code className="font-mono text-white/90">{(block as Extract<Block, { type: "code" }>).code}</code>
          </pre>
        </div>
      );
    case "quote":
      return (
        <blockquote className="mb-6 border-l-2 border-neon/60 pl-4 text-[16px] italic leading-relaxed text-textMuted">
          {block.text}
        </blockquote>
      );
    case "diagram":
      return (
        <div className="mb-6 overflow-x-auto rounded-xl border border-neon/20 bg-white/[0.02] p-5">
          <pre className="font-mono text-[12.5px] leading-relaxed text-neon/90">{block.text}</pre>
        </div>
      );
    case "earnings-table":
      return <EarningsTable title={block.title} rows={block.rows} />;
    case "stock-card": {
      const asset = bySymbol.get(block.symbol);
      const q = quotes.get(block.symbol);
      const up = (q?.changePct ?? 0) >= 0;
      return (
        <Link
          href={`/markets/${block.symbol}`}
          className="group mb-4 flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/25"
        >
          <AssetLogo src={asset ? assetLogoPath(asset) : null} label={block.symbol} size={40} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[14px] font-bold">{block.symbol}</span>
              {q && q.price > 0 && (
                <>
                  <span className="text-[13px] font-semibold text-textPrimary">
                    {q.price >= 1 ? `$${q.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${q.price.toPrecision(3)}`}
                  </span>
                  <span className={`text-[12px] font-semibold ${up ? "text-gain" : "text-loss"}`}>
                    {up ? "+" : ""}
                    {q.changePct.toFixed(2)}%
                  </span>
                </>
              )}
              <SignalBadge signal={block.signal} compact />
            </div>
            <p className="mt-1 text-[12.5px] leading-snug text-textMuted">{block.note}</p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-textMuted transition-transform group-hover:translate-x-0.5" />
        </Link>
      );
    }
    case "price-target": {
      const range = block.target - block.current;
      const upside = (range / block.current) * 100;
      const posPct = Math.max(6, Math.min(94, (block.current / block.target) * 100));
      return (
        <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-textSecondary">
              Price target · <span className="font-mono text-textPrimary">{block.symbol}</span>
            </p>
            <span className={`text-[12px] font-bold ${upside >= 0 ? "text-gain" : "text-loss"}`}>
              {upside >= 0 ? "+" : ""}
              {upside.toFixed(1)}% {upside >= 0 ? "upside" : "downside"}
            </span>
          </div>
          <div className="relative mt-5 h-1.5 rounded-full bg-white/[0.08]">
            <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-neon/40 to-neon" style={{ width: `${posPct}%` }} />
            <span className="absolute -top-[5px] h-4 w-4 -translate-x-1/2 rounded-full border-2 border-black bg-white" style={{ left: `${posPct}%` }} />
          </div>
          <div className="mt-2.5 flex items-center justify-between text-[12px]">
            <span className="text-textMuted">
              Current <span className="font-semibold text-textPrimary">${block.current.toLocaleString("en-US")}</span>
            </span>
            <span className="text-textMuted">
              Target <span className="font-semibold text-neon">${block.target.toLocaleString("en-US")}</span>
            </span>
          </div>
          <p className="mt-2 text-[11px] text-textMuted">{block.analyst}</p>
        </div>
      );
    }
    case "sector-heatmap":
      return <SectorHeat title={block.title} sectors={block.sectors} />;
    default:
      return null;
  }
}

function SectorHeat({ title, sectors }: { title?: string; sectors: SectorPerf[] }) {
  const max = Math.max(...sectors.map((s) => Math.abs(s.changePct)), 1);
  return (
    <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      {title && <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-textSecondary">{title}</p>}
      <div className="space-y-2">
        {[...sectors]
          .sort((a, b) => b.changePct - a.changePct)
          .map((s) => {
            const up = s.changePct >= 0;
            const w = (Math.abs(s.changePct) / max) * 100;
            return (
              <div key={s.sector} className="flex items-center gap-3">
                <span className="w-[136px] shrink-0 truncate text-[12px] text-textSecondary">{s.sector}</span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-white/[0.04]">
                  <div
                    className="h-full rounded"
                    style={{ width: `${Math.max(w, 3)}%`, background: up ? "rgba(48,209,88,0.65)" : "rgba(255,69,58,0.65)" }}
                  />
                </div>
                <span className={`w-[52px] shrink-0 text-right text-[12px] font-semibold ${up ? "text-gain" : "text-loss"}`}>
                  {up ? "+" : ""}
                  {s.changePct}%
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
