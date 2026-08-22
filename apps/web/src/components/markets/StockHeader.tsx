import { fmtCountCompact, fmtPctSigned, fmtPerShare, freshness } from "./format";
import RangeBar from "./RangeBar";
import type { SymbolStats } from "./types";

// The price block: last price, today's move, where that price sits in the day
// and the year, and how much of the day's usual volume has traded.
//
// The freshness badge is computed from the exchange timestamp on the quote
// rather than from whether a fetch succeeded. A page that says LIVE because it
// got a response is claiming something it did not check — a cached Saturday
// close returns 200 exactly like a live print does. No timestamp, no claim.

export default function StockHeader({
  price,
  changePct,
  stats,
  variant = "phone",
}: {
  /** Null when no provider quoted the symbol. Renders as an em-dash, and the
   * range markers below drop out with it rather than parking at one end. */
  price: number | null;
  changePct: number | null;
  stats: SymbolStats;
  /** `desktop` drops the phone column's gutter and scales the price up. Same
   *  component either way — the block is identical, only its size changes. */
  variant?: "phone" | "desktop";
}) {
  const desktop = variant === "desktop";
  const fresh = freshness(stats.marketTime);
  const up = (changePct ?? 0) >= 0;

  // The absolute move is derived from the previous close rather than from the
  // percentage, so it is blank on the same terms the percentage is.
  const changeAbs =
    price !== null && stats.previousClose !== null && Number.isFinite(stats.previousClose)
      ? price - stats.previousClose
      : null;

  const volumeRatio =
    stats.volume !== null && stats.avgVolume !== null && stats.avgVolume > 0
      ? stats.volume / stats.avgVolume
      : null;

  return (
    <section className={desktop ? "" : "px-5"}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p
            className={`font-mono font-extrabold leading-none tracking-tighter ${
              desktop ? "text-[52px]" : "text-[34px]"
            }`}
          >
            {fmtPerShare(price)}
          </p>
          <p
            className={`mt-2 font-mono font-semibold ${desktop ? "text-[16px]" : "text-[14px]"} ${
              changePct === null ? "text-textMuted" : up ? "text-gain" : "text-loss"
            }`}
          >
            {changePct === null ? (
              "Change unavailable"
            ) : (
              <>
                {up ? "▲" : "▼"} {changeAbs === null ? "" : `${fmtPerShare(Math.abs(changeAbs))} `}
                ({fmtPctSigned(changePct)}) today
              </>
            )}
          </p>
        </div>
        {fresh && (
          <span
            className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              fresh.live ? "bg-gain/10 text-gain" : "bg-white/[0.06] text-textMuted"
            }`}
            title={
              fresh.live
                ? "Last trade printed within the last 90 seconds."
                : "Time since the last trade printed on the exchange."
            }
          >
            {fresh.live && <span className="h-1 w-1 animate-pulse rounded-full bg-gain" />}
            {fresh.label.toUpperCase()}
          </span>
        )}
      </div>

      <div className={desktop ? "mt-6 grid grid-cols-2 gap-x-10 gap-y-3" : "mt-4 space-y-3"}>
        <RangeBar label="Day range" low={stats.dayLow} high={stats.dayHigh} value={price} />
        <RangeBar label="52-week range" low={stats.low52w} high={stats.high52w} value={price} />
      </div>

      {volumeRatio !== null && (
        <p className={`mt-3 font-mono text-textMuted ${desktop ? "text-[13px]" : "text-[11.5px]"}`}>
          Vol {fmtCountCompact(stats.volume)} / avg {fmtCountCompact(stats.avgVolume)}
          <span className={volumeRatio >= 1 ? "ml-1.5 text-gain" : "ml-1.5 text-textSecondary"}>
            ({volumeRatio.toFixed(2)}×)
          </span>
        </p>
      )}
    </section>
  );
}
