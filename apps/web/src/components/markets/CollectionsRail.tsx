"use client";

import { useRef } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  BrainCircuit, Cpu, Leaf, ShieldCheck, Car, CreditCard, Rocket, Plane, Crown, TrendingUp,
  Gem, Scale, CalendarClock, Bitcoin, Layers, Network, Landmark, Bot, Gamepad2, Sparkles,
} from "lucide-react";
import { COLLECTIONS } from "@/lib/markets/collections";
import { fmtPctSigned } from "./format";
import type { TableRow } from "@/lib/markets/table";

// ---------------------------------------------------------------------------
// Collections — the themed cards between Trending and the table.
//
// THE PERFORMANCE FIGURE IS COMPUTED, NOT COPIED. Each card shows the average
// 24h change across the collection's members, taken from the same rows the
// table renders, and it is only shown when EVERY member that is in the catalog
// has a live change. A "+9.42% today" averaged over half a collection is a
// number about a set the reader cannot see, so a partially-priced collection
// shows its asset count and no percentage at all.
//
// Clicking a card filters this page rather than navigating to
// /markets/collections/<slug>. That page still exists and is still linked from
// the "View all" affordance — but the reference behaviour is an in-place filter,
// and it is the better one: the reader keeps the table, the sort and the
// scroll position they already had.
// ---------------------------------------------------------------------------

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  BrainCircuit, Cpu, Leaf, ShieldCheck, Car, CreditCard, Rocket, Plane, Crown, TrendingUp,
  Gem, Scale, CalendarClock, Bitcoin, Layers, Network, Landmark, Bot, Gamepad2,
};

export default function CollectionsRail({
  rows,
  activeSlug,
  onSelect,
}: {
  /** The full unfiltered row set, for computing collection performance. */
  rows: TableRow[] | null;
  activeSlug: string | null;
  onSelect: (slug: string | null) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);

  const bySymbol = new Map((rows ?? []).map((r) => [r.symbol, r]));

  return (
    <section className="mt-6" aria-labelledby="collections-heading">
      <div className="mb-2.5 flex items-end justify-between">
        <div>
          <h2 id="collections-heading" className="text-[15px] font-bold tracking-tight text-white">
            Collections
          </h2>
          <p className="text-[11.5px] text-textMuted">Discover by theme</p>
        </div>
        <Link
          href="/markets/collections/ai-robotics"
          className="text-[12px] font-semibold text-accent transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          View all →
        </Link>
      </div>

      <div className="relative">
        <div
          ref={railRef}
          className="rail-scroll flex snap-x gap-2.5 overflow-x-auto pb-2"
          role="group"
          aria-label="Asset collections"
        >
          {COLLECTIONS.map((col) => {
            const Icon = ICONS[col.icon] ?? Sparkles;
            const active = col.slug === activeSlug;

            // Only members this catalog actually carries.
            const members = col.symbols.map((s) => bySymbol.get(s)).filter((r): r is TableRow => !!r);
            const priced = members.filter((m) => m.changePct != null);
            // Every member priced, or no figure at all.
            const avg =
              members.length > 0 && priced.length === members.length
                ? priced.reduce((s, m) => s + (m.changePct as number), 0) / priced.length
                : null;
            const up = avg != null && avg >= 0;

            return (
              <button
                key={col.slug}
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(active ? null : col.slug)}
                style={{
                  background: `linear-gradient(135deg, ${col.gradient[0]}, ${col.gradient[1]}cc)`,
                }}
                className={`relative w-[152px] shrink-0 snap-start overflow-hidden rounded-2xl p-3.5 text-left transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  active ? "ring-2 ring-accent ring-offset-2 ring-offset-oled" : "hover:scale-[1.015]"
                }`}
              >
                {/* A soft highlight rather than a second gradient — the card
                    already carries one and stacking them muddies the theme. */}
                <span
                  className="pointer-events-none absolute -right-5 -top-5 h-16 w-16 rounded-full bg-white/15 blur-xl"
                  aria-hidden
                />
                <Icon className="h-5 w-5 text-textPrimary" aria-hidden />
                <span className="mt-2 block text-[12.5px] font-bold leading-tight text-white">
                  {col.title}
                </span>
                <span className="mt-1 block text-[10.5px] font-medium text-textSecondary font-mono">
                  {members.length} asset{members.length === 1 ? "" : "s"}
                </span>
                {avg != null && (
                  <span
                    className={`mt-0.5 block text-[10.5px] font-bold font-mono ${
                      up ? "text-emerald-200" : "text-rose-200"
                    }`}
                  >
                    {fmtPctSigned(avg)} today
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Scroll affordance. Hidden from assistive tech: the rail itself is
            keyboard-scrollable and every card is already in the tab order. */}
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={() => railRef.current?.scrollBy({ left: 320, behavior: "smooth" })}
          className="absolute right-0 top-1/2 hidden h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-surface/90 text-textSecondary backdrop-blur transition-colors hover:text-white lg:grid"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
