// ---------------------------------------------------------------------------
// The markets table: row shape, filtering, sorting and pagination.
//
// Pure functions over plain data, deliberately kept out of the route handler.
// Sorting a nullable column and paginating a filtered set are exactly the kind
// of logic that is easy to get subtly wrong (a null sorting FIRST puts every
// unpriced asset at the top of "highest market cap"), and a pure module is one
// a spec can pin without standing up a request.
//
// The rule the whole file is built around: a missing number is null, never 0.
// `?? 0` appears only inside comparators, where it decides an ORDER — and even
// there, nulls are pushed to the end regardless of direction, because "we do
// not know this asset's market cap" is not a claim that it is the smallest.
// ---------------------------------------------------------------------------

/** "instrument" is everything that is not a security: gold, the crude grades,
 *  natural gas, the FX pairs. They have no CUSIP, no issuer and no market cap,
 *  which is why they are a separate kind rather than a sector of "stock". */
export type AssetKindFilter = "stock" | "etf" | "crypto" | "instrument";

/** One rendered row. Every market figure is nullable and draws as an em-dash. */
export interface TableRow {
  symbol: string;
  name: string;
  kind: AssetKindFilter;
  /** Sector (stocks) or category (ETFs / crypto) — the badge under the name. */
  category: string | null;
  logo: string | null;
  price: number | null;
  changePct: number | null;
  changePct7d: number | null;
  marketCap: number | null;
  volume24h: number | null;
  /** Closing prices, oldest to newest, or null when no history was available. */
  spark: number[] | null;
  /** Whether a provider priced this asset in the current cache window. */
  live: boolean;
  /** Curated catalog rank, used as the "popularity" order. */
  rank: number;
}

export type SortKey =
  | "popularity"
  | "price"
  | "change"
  | "change7d"
  | "marketCap"
  | "volume"
  | "name";

export type SortDir = "asc" | "desc";

export const SORT_KEYS: readonly SortKey[] = [
  "popularity",
  "price",
  "change",
  "change7d",
  "marketCap",
  "volume",
  "name",
] as const;

export function isSortKey(v: string | null | undefined): v is SortKey {
  return !!v && (SORT_KEYS as readonly string[]).includes(v);
}

/** Market-cap buckets, in USD. Boundaries are the conventional US equity ones
 *  (large >= $10B, mid >= $2B); crypto is measured on the same axis so a single
 *  filter means one thing across the table. */
export const CAP_BANDS = {
  large: { min: 10e9, max: Infinity },
  mid: { min: 2e9, max: 10e9 },
  small: { min: 0, max: 2e9 },
} as const;

export type CapBand = keyof typeof CAP_BANDS;

export function isCapBand(v: string | null | undefined): v is CapBand {
  return v === "large" || v === "mid" || v === "small";
}

export interface TableFilters {
  kinds?: AssetKindFilter[];
  /** "gainers" keeps rows up on the day, "losers" keeps rows down. */
  performance?: "gainers" | "losers" | null;
  capBands?: CapBand[];
  priceMin?: number | null;
  priceMax?: number | null;
  volumeMin?: number | null;
  volumeMax?: number | null;
  /** Substring match over symbol, name and category. */
  query?: string | null;
  /** Restrict to an explicit symbol set (a collection, or the watchlist). */
  symbols?: string[] | null;
}

/**
 * Apply every filter.
 *
 * A row missing the value a filter tests is EXCLUDED, not kept. A minimum
 * volume of $1B cannot be said to be satisfied by an asset whose volume is
 * unknown, and quietly keeping it would present unknowns as matches.
 */
export function applyFilters(rows: TableRow[], f: TableFilters): TableRow[] {
  const kinds = f.kinds?.length ? new Set(f.kinds) : null;
  const bands = f.capBands?.length ? f.capBands.map((b) => CAP_BANDS[b]) : null;
  const only = f.symbols?.length ? new Set(f.symbols.map((s) => s.toUpperCase())) : null;
  const q = f.query?.trim().toLowerCase() || null;

  return rows.filter((r) => {
    if (kinds && !kinds.has(r.kind)) return false;
    if (only && !only.has(r.symbol.toUpperCase())) return false;

    if (f.performance) {
      if (r.changePct == null) return false;
      if (f.performance === "gainers" && r.changePct <= 0) return false;
      if (f.performance === "losers" && r.changePct >= 0) return false;
    }

    if (bands) {
      if (r.marketCap == null) return false;
      if (!bands.some((b) => r.marketCap! >= b.min && r.marketCap! < b.max)) return false;
    }

    if (f.priceMin != null) {
      if (r.price == null || r.price < f.priceMin) return false;
    }
    if (f.priceMax != null) {
      if (r.price == null || r.price > f.priceMax) return false;
    }
    if (f.volumeMin != null) {
      if (r.volume24h == null || r.volume24h < f.volumeMin) return false;
    }
    if (f.volumeMax != null) {
      if (r.volume24h == null || r.volume24h > f.volumeMax) return false;
    }

    if (q) {
      const hay = `${r.symbol} ${r.name} ${r.category ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** The numeric field a sort key reads, or null for the two non-numeric keys. */
function valueFor(r: TableRow, key: SortKey): number | null {
  switch (key) {
    case "price":
      return r.price;
    case "change":
      return r.changePct;
    case "change7d":
      return r.changePct7d;
    case "marketCap":
      return r.marketCap;
    case "volume":
      return r.volume24h;
    case "popularity":
      return r.rank;
    case "name":
      return null;
  }
}

/**
 * Sort a copy of the rows.
 *
 * Nulls always sink to the bottom, in BOTH directions. Ascending market cap
 * with nulls treated as 0 would open the table with a page of assets whose
 * market cap is simply unknown, presented as the smallest companies listed.
 */
export function sortRows(rows: TableRow[], key: SortKey, dir: SortDir): TableRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    // Sort by the NAME, because that is what the control is labelled and what
    // the cell shows. It used to sort by ticker, so choosing "Name" and
    // ascending put "Apple Inc." above "Alphabet Inc." — correct for AAPL
    // before GOOGL, and visibly wrong beside a column of company names.
    //
    // Ticker breaks the tie so the order is stable between renders when two
    // issuers share a name.
    if (key === "name") {
      const byName = a.name.localeCompare(b.name, "en", { sensitivity: "base" });
      return sign * (byName !== 0 ? byName : a.symbol.localeCompare(b.symbol));
    }
    const va = valueFor(a, key);
    const vb = valueFor(b, key);
    if (va == null && vb == null) return a.rank - b.rank;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (va === vb) return a.rank - b.rank;
    return sign * (va - vb);
  });
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * Slice one page.
 *
 * `pageCount` is derived from the real total, so the pager never offers a page
 * that does not exist. An out-of-range page clamps to the last one rather than
 * rendering an empty table that looks like a failed load.
 */
export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const size = Math.max(1, Math.floor(pageSize));
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * size;
  return {
    items: items.slice(start, start + size),
    total,
    page: current,
    pageSize: size,
    pageCount,
  };
}

/** The default sort for each key — the direction a reader means when they pick
 *  it. "Market cap" means largest first; "name" means A to Z. */
export function defaultDirFor(key: SortKey): SortDir {
  return key === "name" || key === "popularity" ? "asc" : "desc";
}
