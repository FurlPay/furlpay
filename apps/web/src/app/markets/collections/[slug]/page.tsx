"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getJSON } from "@/lib/api";
import { Spinner, pct } from "@/components/ui";
import AssetRow from "@/components/AssetRow";
import { collectionBySlug } from "@/lib/markets/collections";

// Collection detail — themed asset list with a day-performance summary.

interface MarketItem {
  symbol: string;
  name: string;
  kind: string;
  industry: string | null;
  logo: string | null;
  price: number;
  changePct: number;
}

export default function CollectionPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const col = collectionBySlug(slug);
  const [items, setItems] = useState<MarketItem[] | null>(null);

  const load = useCallback(() => {
    getJSON<{ items: MarketItem[] }>(`/api/markets?collection=${slug}`).then((r) => setItems(r.items)).catch(console.error);
  }, [slug]);
  useEffect(() => load(), [load]);

  if (!col) {
    return (
      <div className="px-5 py-16 text-center">
        <p className="font-semibold">Collection not found</p>
        <Link href="/markets" className="mt-2 inline-block text-[13px] text-accent">Back to markets</Link>
      </div>
    );
  }
  if (!items) return <Spinner />;

  const avg = items.length ? items.reduce((s, i) => s + i.changePct, 0) / items.length : 0;
  const gainers = items.filter((i) => i.changePct >= 0).length;

  return (
    <>
      {/* Gradient header */}
      <div className="relative overflow-hidden pb-5" style={{ background: `linear-gradient(160deg, ${col.gradient[0]}, ${col.gradient[1]}55 65%, transparent)` }}>
        <header className="flex items-center gap-3 px-5 pb-2 pt-3">
          <button aria-label="Back" onClick={() => router.back()} className="tap flex h-10 w-10 items-center justify-center rounded-full bg-black/30 backdrop-blur">
            <ArrowLeft className="h-5 w-5" />
          </button>
        </header>
        <div className="px-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/60">{col.kind} collection</p>
          <h1 className="mt-1 text-[26px] font-extrabold tracking-tighter">{col.title}</h1>
          <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-white/70">{col.blurb}</p>
          <div className="mt-4 flex gap-2.5">
            <span className="rounded-full bg-black/30 px-3 py-1.5 text-[12px] font-semibold backdrop-blur">
              {items.length} assets
            </span>
            <span className={`rounded-full bg-black/30 px-3 py-1.5 text-[12px] font-semibold backdrop-blur ${avg >= 0 ? "text-gain" : "text-loss"}`}>
              {pct(avg)} avg today
            </span>
            <span className="rounded-full bg-black/30 px-3 py-1.5 text-[12px] font-semibold text-textSecondary backdrop-blur">
              {gainers}/{items.length} advancing
            </span>
          </div>
        </div>
      </div>

      <ul className="mt-2 space-y-0.5 px-2 pb-8">
        {items.map((i) => (
          <li key={i.symbol}>
            <AssetRow item={{ ...i, sub: i.industry ? `${i.name} · ${i.industry}` : i.name }} href={`/markets/${i.symbol}`} />
          </li>
        ))}
      </ul>
    </>
  );
}
