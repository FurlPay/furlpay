// ---------------------------------------------------------------------------
// Corridor arithmetic for the /onchain flows map. PURE, client-safe.
//
// The corridors come from a saved Allium query (ALLIUM_CORRIDOR_QUERY_ID):
// country pairs assigned by Allium's geographic attribution. A wallet has no
// country of its own, so every figure here is INFERRED, and the share each
// corridor gets is a share of the corridors returned, not of all stablecoin
// volume (the query does not report how much volume had no country).
// ---------------------------------------------------------------------------

export interface Corridor {
  from: string;
  to: string;
  volumeUsd: number;
}

export interface CountryTotal {
  code: string;
  inboundUsd: number;
  outboundUsd: number;
  /** Inbound + outbound across the listed corridors. A corridor touching the
   *  country twice (domestic, XX→XX) counts once. */
  touchedUsd: number;
  corridors: number;
}

const isCode = (c: string) => /^[A-Z]{2}$/.test(c);

/** Drop malformed and zero rows, merge duplicates, sort by volume. */
export function cleanCorridors(rows: readonly Corridor[]): Corridor[] {
  const merged = new Map<string, Corridor>();
  for (const r of rows) {
    if (!isCode(r.from) || !isCode(r.to) || !Number.isFinite(r.volumeUsd) || r.volumeUsd <= 0) continue;
    const k = `${r.from}>${r.to}`;
    const cur = merged.get(k);
    merged.set(k, cur ? { ...cur, volumeUsd: cur.volumeUsd + r.volumeUsd } : { ...r });
  }
  return [...merged.values()].sort((a, b) => b.volumeUsd - a.volumeUsd || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

export function countryTotals(rows: readonly Corridor[]): CountryTotal[] {
  const t = new Map<string, CountryTotal>();
  const get = (code: string) => t.get(code) ?? t.set(code, { code, inboundUsd: 0, outboundUsd: 0, touchedUsd: 0, corridors: 0 }).get(code)!;
  for (const c of cleanCorridors(rows)) {
    const o = get(c.from);
    o.outboundUsd += c.volumeUsd;
    o.touchedUsd += c.volumeUsd;
    o.corridors += 1;
    if (c.to === c.from) {
      o.inboundUsd += c.volumeUsd;
      continue;
    }
    const d = get(c.to);
    d.inboundUsd += c.volumeUsd;
    d.touchedUsd += c.volumeUsd;
    d.corridors += 1;
  }
  return [...t.values()].sort((a, b) => b.touchedUsd - a.touchedUsd || a.code.localeCompare(b.code));
}

/** Share of the LISTED corridors' total, in [0, 1]. */
export function corridorShare(rows: readonly Corridor[], c: Corridor): number {
  const total = cleanCorridors(rows).reduce((n, r) => n + r.volumeUsd, 0);
  return total > 0 ? c.volumeUsd / total : 0;
}

/** A quadratic arc between two map points that bows upward, flatter for short hops. */
export function arcPath(a: readonly [number, number], b: readonly [number, number]): string {
  const mx = (a[0] + b[0]) / 2;
  const my = Math.min(a[1], b[1]) - Math.abs(a[0] - b[0]) * 0.28 - 6;
  return `M${a[0]},${a[1]} Q${mx},${my} ${b[0]},${b[1]}`;
}

/** "BR" → "Brazil"; falls back to the code where Intl has no name. */
export function countryName(code: string, locale = "en"): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** "BR" → 🇧🇷 (regional indicator symbols). */
export function flag(code: string): string {
  if (!isCode(code)) return "";
  return String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}
