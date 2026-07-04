// 2-column key-stats grid for asset detail pages.
export interface StatItem {
  label: string;
  value: string;
}

export default function StatsGrid({ items }: { items: StatItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-0">
      {items.map((s) => (
        <div key={s.label} className="flex items-center justify-between border-b border-white/[0.05] py-2.5">
          <span className="text-[12px] text-textSecondary">{s.label}</span>
          <span className="text-[13px] font-semibold">{s.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Compact number formatting for stats: 1.2T / 45.6B / 890M / 12.4K. */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(2);
}
