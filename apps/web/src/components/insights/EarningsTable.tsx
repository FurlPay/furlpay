import { Check, X, Minus } from "lucide-react";
import type { EarningsRow } from "@/lib/insights/articles";

// Premium earnings table — beat/miss conditional colouring, glassmorphic
// surface, horizontal scroll inside its own container.
export default function EarningsTable({ title, rows }: { title?: string; rows: EarningsRow[] }) {
  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
      {title && (
        <div className="border-b border-white/5 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-textSecondary">
          {title}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[440px] text-left">
          <thead>
            <tr className="border-b border-white/5 text-[11px] uppercase tracking-wider text-textMuted">
              <th className="px-4 py-2.5 font-medium">Metric</th>
              <th className="px-4 py-2.5 font-medium">Actual</th>
              <th className="px-4 py-2.5 font-medium">Estimate</th>
              <th className="px-4 py-2.5 text-right font-medium">Surprise</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.metric} className="border-b border-white/[0.04] last:border-0">
                <td className="px-4 py-3 text-[13px] font-semibold text-textPrimary">{r.metric}</td>
                <td className={`px-4 py-3 text-[13px] font-bold ${r.beat === true ? "text-gain" : r.beat === false ? "text-loss" : "text-textPrimary"}`}>
                  {r.actual}
                </td>
                <td className="px-4 py-3 text-[13px] text-textMuted">{r.estimate}</td>
                <td className="px-4 py-3 text-right">
                  {r.surprise ? (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        r.beat === true ? "bg-gain/10 text-gain" : r.beat === false ? "bg-loss/10 text-loss" : "bg-white/[0.06] text-textSecondary"
                      }`}
                    >
                      {r.beat === true ? <Check className="h-3 w-3" /> : r.beat === false ? <X className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                      {r.surprise}
                    </span>
                  ) : (
                    <span className="text-[12px] text-textMuted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
