import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { CATALOG, assetLogoPath, AssetKind } from "@/lib/markets/catalog";
import { collectionBySlug } from "@/lib/markets/collections";
import { getQuotes, resolveQuote } from "@/lib/markets/quotes";

// GET /api/markets — tradable asset catalog with the latest prices.
// Filters: ?kind=stock|etf|crypto  ?sector=Technology  ?category=<crypto cat / etf cat>
//          ?collection=<slug>  ?chain=<crypto chain>  ?cap=mega|large|mid|small  ?q=<search>
// Sorting: ?sort=changePct|-changePct|price|-price|symbol   Paging: ?limit=
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const kind = p.get("kind") as AssetKind | null;
  const sector = p.get("sector");
  const category = p.get("category");
  const chain = p.get("chain");
  const cap = p.get("cap");
  const q = (p.get("q") ?? "").trim().toLowerCase();
  const sort = p.get("sort");
  const limit = Number(p.get("limit")) || 0;
  const collection = p.get("collection") ? collectionBySlug(p.get("collection")!) : null;

  const quotes = await getQuotes();

  let assets = CATALOG;
  if (collection) {
    const set = new Set(collection.symbols);
    assets = assets.filter((a) => set.has(a.symbol));
  }
  if (kind) assets = assets.filter((a) => a.kind === kind);
  if (sector) assets = assets.filter((a) => a.sector === sector);
  if (category) assets = assets.filter((a) => a.industry === category);
  if (chain) assets = assets.filter((a) => a.chain === chain);
  if (cap) assets = assets.filter((a) => (a.cap ?? "large") === cap);
  if (q) {
    assets = assets.filter(
      (a) => a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.industry?.toLowerCase().includes(q)
    );
  }

  let items = assets.map((a) => {
    // quoteFor, not quotes.get(symbol): STX and DASH each name two different
    // assets, and the bare ticker deliberately resolves to neither.
    const quote = resolveQuote(quotes, a);
    return {
      symbol: a.symbol,
      name: a.name,
      kind: a.kind,
      sector: a.sector ?? null,
      industry: a.industry ?? null,
      cap: a.cap ?? "large",
      chain: a.chain ?? null,
      logo: assetLogoPath(a),
      price: quote?.price ?? 0,
      changePct: quote?.changePct ?? 0,
      live: quote?.live ?? false,
    };
  });

  if (collection) {
    const order = new Map(collection.symbols.map((s, i) => [s, i]));
    items.sort((a, b) => (order.get(a.symbol) ?? 999) - (order.get(b.symbol) ?? 999));
  }
  if (sort) {
    const desc = sort.startsWith("-");
    const key = (desc ? sort.slice(1) : sort) as "changePct" | "price" | "symbol";
    items.sort((a, b) => {
      const va = a[key], vb = b[key];
      const cmp = typeof va === "string" ? String(va).localeCompare(String(vb)) : Number(va) - Number(vb);
      return desc ? -cmp : cmp;
    });
  }
  if (limit > 0) items = items.slice(0, limit);

  return NextResponse.json({
    items,
    collection: collection ? { slug: collection.slug, title: collection.title, blurb: collection.blurb, gradient: collection.gradient, icon: collection.icon } : null,
    asOf: new Date().toISOString(),
  });
}
