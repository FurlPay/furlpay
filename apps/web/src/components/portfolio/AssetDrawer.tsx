"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { X } from "lucide-react";
import { AssetLogo } from "@furlpay/ui";
import PriceChart from "@/components/PriceChart";
import { assetLogoPath, bySymbol } from "@/lib/markets/catalog";
import type { PositionRow } from "@/lib/portfolioMetrics";
import { Delta, money } from "./primitives";

// ---------------------------------------------------------------------------
// The right-side asset drawer.
//
// It opens over the dashboard instead of navigating, because the value of this
// panel is that the portfolio behind it stays on screen — a reader comparing a
// position against their allocation should not lose the allocation to look.
//
// Same modal discipline as the account page's ConfirmDialog: focus moves in,
// Tab is trapped, Escape closes, focus returns to the row that opened it, and
// the page behind cannot scroll. Rendered through a portal so the sticky header
// (z-40) cannot clip it.
// ---------------------------------------------------------------------------

export default function AssetDrawer({
  position,
  onClose,
}: {
  position: PositionRow | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!position) return;
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button, a[href]")?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, select") ?? []
      ).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      returnFocusTo.current?.focus?.();
    };
  }, [position, close]);

  if (!position) return null;
  if (typeof document === "undefined") return null;

  const asset = bySymbol.get(position.symbol);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex justify-end bg-black/60 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-full w-full max-w-[420px] flex-col overflow-y-auto border-l border-white/[0.08] bg-[#0B0B0D] shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-white/[0.06] bg-[#0B0B0D]/95 px-5 py-4 backdrop-blur">
          <AssetLogo src={asset ? assetLogoPath(asset) : null} label={position.symbol} size={38} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-[16px] font-bold text-white">
              {position.symbol}
            </h2>
            <p className="truncate text-[12px] text-textSecondary">{position.name}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close asset details"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-textSecondary transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="text-[26px] font-extrabold leading-none tracking-tight tabular-nums text-white">
            {money(position.price)}
          </p>
          <p className="mt-1.5 text-[12.5px]">
            <Delta value={position.changePct} /> <span className="text-textSecondary">today</span>
          </p>
        </div>

        <div className="px-3">
          <PriceChart
            seed={`asset-${position.symbol}`}
            endValue={position.price}
            symbol={position.symbol}
            height={168}
            defaultTf="1M"
          />
        </div>

        <div className="mt-2 px-5 py-4">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-textMuted">Your position</h3>
          <dl className="mt-2.5 divide-y divide-white/[0.05] rounded-xl border border-white/[0.06]">
            <Line label="Shares" value={position.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })} />
            <Line label="Average cost" value={money(position.avgPrice)} />
            <Line label="Market value" value={money(position.marketValue)} />
            <Line label="Cost basis" value={money(position.costBasis)} />
            <Line label="Allocation" value={`${(position.weight * 100).toFixed(1)}% of invested`} />
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <dt className="text-[12.5px] text-textSecondary">Unrealised P/L</dt>
              <dd className="text-right text-[13px]">
                <Delta value={position.unrealized} prefix="$" suffix="" />
                <span className="ml-1.5 text-[11.5px] text-textMuted">
                  (<Delta value={position.unrealizedPct} showSign={false} />)
                </span>
              </dd>
            </div>
          </dl>
        </div>

        {/* Actions. These LINK to the surfaces that can actually transact —
            they do not fake an order ticket inside a drawer. */}
        <div className="mt-auto grid grid-cols-3 gap-2 border-t border-white/[0.06] p-4">
          <Link
            href={`/markets/${position.symbol}`}
            className="rounded-lg bg-gain py-2.5 text-center text-[12.5px] font-bold text-[#04220F] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
          >
            Buy
          </Link>
          <Link
            href={`/markets/${position.symbol}`}
            className="rounded-lg border border-white/[0.14] py-2.5 text-center text-[12.5px] font-semibold text-white transition-colors hover:border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
          >
            Sell
          </Link>
          <Link
            href="/markets?panel=watchlist"
            className="rounded-lg border border-white/[0.14] py-2.5 text-center text-[12.5px] font-semibold text-white transition-colors hover:border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
          >
            Watch
          </Link>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3.5 py-2.5">
      <dt className="text-[12.5px] text-textSecondary">{label}</dt>
      <dd className="text-[13px] font-semibold tabular-nums text-white">{value}</dd>
    </div>
  );
}
