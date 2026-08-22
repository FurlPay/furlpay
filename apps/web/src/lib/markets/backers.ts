// ---------------------------------------------------------------------------
// Strategic backers — "who put money into this company, and on what terms".
//
// The question this answers is the one a 13F cannot: not "which fund manager
// holds shares" (Vanguard holds everything) but "which OPERATING company took
// a stake or signed a multi-billion commitment", which is the relationship that
// actually tells you something about an asset.
//
// No free API publishes that. It lives in press releases, 8-Ks and F-1s, so
// this is a CURATED dataset — and curation on a money surface has exactly one
// safeguard that makes it acceptable:
//
//   AN ENTRY WITHOUT `verified: true` IS NOT RENDERED.
//
// `backersFor()` filters on it, so an entry drafted from memory sits inert in
// this file until a person opens `source`, confirms the claim word for word,
// and flips the flag. That is the difference between a curated dataset and a
// fabricated one, and it is enforced in code rather than by convention.
//
// Every field is a matter of public record. There are no estimates, no implied
// valuations, no forward revenue and no price targets in this file — those
// belong to analysts, not to a catalog.
// ---------------------------------------------------------------------------

export interface Backer {
  /** The investing or contracting entity, as it names itself. */
  name: string;
  /**
   * What the relationship actually is. Kept distinct because they are NOT
   * interchangeable — a supply agreement is not ownership, and presenting one
   * as the other is the specific error this field exists to prevent.
   *
   *   equity     bought or holds shares
   *   warrant    holds warrants / the right to acquire shares
   *   commercial a disclosed multi-year purchase or capacity commitment
   *   partner    a named technology or distribution partnership, no money
   *              disclosed
   */
  relationship: "equity" | "warrant" | "commercial" | "partner";
  /** One line, factual, no adjectives. Shown verbatim. */
  detail: string;
  /** Disclosed size in USD, or null when the parties did not disclose one.
   *  Never an estimate. */
  amountUsd: number | null;
  /** ISO date the arrangement was announced. */
  announced: string;
  /** Where the claim is stated. Required — there is no entry without one. */
  source: string;
  /** How to name the source in the UI, e.g. "Nebius press release". */
  sourceLabel: string;
  /**
   * Has a human opened `source` and confirmed this entry?
   *
   * Seeded false. Nothing with false reaches the UI. Flipping it is a
   * deliberate act by someone who read the citation.
   */
  verified: boolean;
}

/**
 * Backers by catalog symbol.
 *
 * DRAFT ENTRIES BELOW ARE ALL `verified: false` and therefore invisible in the
 * product. They are recorded here so the verification pass has something
 * concrete to check rather than a blank file. Do not flip a flag without
 * opening the URL on the same line.
 */
export const BACKERS: Record<string, Backer[]> = {
  NBIS: [
    {
      name: "NVIDIA",
      relationship: "equity",
      detail: "Participated in the December 2024 private placement.",
      amountUsd: null,
      announced: "2024-12-02",
      source: "https://group.nebius.com/newsroom",
      sourceLabel: "Nebius newsroom",
      verified: false,
    },
    {
      name: "Microsoft",
      relationship: "commercial",
      detail: "Multi-year agreement for dedicated AI compute capacity.",
      amountUsd: null,
      announced: "2025-09-08",
      source: "https://group.nebius.com/newsroom",
      sourceLabel: "Nebius newsroom",
      verified: false,
    },
    {
      name: "Meta",
      relationship: "commercial",
      detail: "Multi-year agreement for dedicated AI compute capacity.",
      amountUsd: null,
      announced: "2025-10-01",
      source: "https://group.nebius.com/newsroom",
      sourceLabel: "Nebius newsroom",
      verified: false,
    },
  ],
  AAOI: [
    {
      name: "Amazon",
      relationship: "warrant",
      detail: "Received warrants to acquire shares alongside a supply agreement.",
      amountUsd: null,
      announced: "2024-03-01",
      source: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=AAOI&type=8-K",
      sourceLabel: "SEC EDGAR — AAOI 8-K filings",
      verified: false,
    },
  ],
};

/**
 * The backers that may actually be shown for a symbol.
 *
 * Verified only, newest first. An unknown symbol and a symbol whose entries are
 * all unverified are the SAME result — an empty array — and the UI renders
 * nothing at all rather than a "no data" placeholder that implies we looked and
 * found none.
 */
export function backersFor(symbol: string): Backer[] {
  const rows = BACKERS[symbol.toUpperCase()] ?? [];
  return rows
    .filter((b) => b.verified)
    .slice()
    .sort((a, b) => b.announced.localeCompare(a.announced));
}

/** Every symbol with at least one VERIFIED backer — what the UI may badge. */
export function symbolsWithBackers(): string[] {
  return Object.keys(BACKERS).filter((s) => backersFor(s).length > 0);
}

/** Counts for the verification pass: how much of this file is still draft. */
export function backerAudit(): { symbol: string; total: number; verified: number }[] {
  return Object.entries(BACKERS).map(([symbol, rows]) => ({
    symbol,
    total: rows.length,
    verified: rows.filter((b) => b.verified).length,
  }));
}
