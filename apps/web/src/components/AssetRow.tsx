"use client";

// Reusable market asset list row: logo, name, sparkline, price + day change.
import Link from "next/link";
import { AssetLogo } from "@furlpay/ui";
import { pct, usd } from "@/components/ui";
import MiniSparkline from "@/components/MiniSparkline";

export interface AssetRowData {
  symbol: string;
  name: string;
  logo: string | null;
  /** Nullable: universe-search rows for uncurated assets carry no quote. */
  price: number | null;
  changePct: number | null;
  sub?: string;
}

/** Price formatter. Accepts null/undefined because /api/markets/search spans
 *  the full tradable universe and returns uncurated assets UNPRICED — those
 *  must render "—", never "$0.00", which would read as "this is worthless". */
export function fmtPrice(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  if (p >= 1) return usd(p);
  if (p <= 0) return "—";
  return "$" + p.toPrecision(3);
}

export default function AssetRow({
  item,
  href,
  onClick,
  sparkline = true,
  size = "md",
}: {
  item: AssetRowData;
  href?: string;
  onClick?: () => void;
  sparkline?: boolean;
  size?: "sm" | "md";
}) {
  // `null >= 0` is TRUE in JS — an unpriced row would render green with a
  // fake gain. Check explicitly.
  const hasChange = item.changePct != null && Number.isFinite(item.changePct);
  const up = hasChange && (item.changePct as number) >= 0;
  const inner = (
    <>
      <AssetLogo src={item.logo} label={item.symbol} size={size === "sm" ? 32 : 38} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className={`truncate font-semibold ${size === "sm" ? "text-[14px]" : ""}`}>{item.symbol}</p>
        <p className="truncate text-[12px] text-textSecondary">{item.sub ?? item.name}</p>
      </div>
      {sparkline && <MiniSparkline seed={`row-${item.symbol}`} changePct={item.changePct ?? 0} className="shrink-0" />}
      <div className="w-[86px] shrink-0 text-right">
        <p className={`font-semibold ${size === "sm" ? "text-[14px]" : ""}`}>{fmtPrice(item.price)}</p>
        <p className={`text-[12px] font-medium ${up ? "text-gain" : "text-loss"}`}>{pct(item.changePct)}</p>
      </div>
    </>
  );
  const cls = "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-white/[0.03]";
  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}
