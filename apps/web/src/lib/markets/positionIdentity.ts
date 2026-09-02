// ---------------------------------------------------------------------------
// The join between a 13F position and market data.
//
// `positionsByIssuer` produces holdings keyed by CUSIP; every price, volume and
// market-cap provider in this app is keyed by ticker. This module is the only
// place those two meet, and it meets them through identifiers alone. No issuer
// name reaches the resolver — names are for display, never for identity.
//
// ── WHICH IDENTIFIER REPRESENTS A POSITION ─────────────────────────────────
//
// An issuer row aggregates up to three different instruments under one CUSIP6
// prefix: an equity line, a convertible-debt line, and option lines. They are
// not interchangeable, so the position resolves against exactly one of them and
// says which:
//
//   1. The SHARE CUSIP, when there is one. This is the equity a reader means by
//      "owns", and it is what should carry a ticker and a price.
//   2. Otherwise the DEBT CUSIP. A debt-only position is real and reportable —
//      JPMorgan holds $4,080,452 of IREN notes under 46270CAB5 with no IREN
//      equity under that prefix — and resolving it yields the bond, which is
//      the honest answer.
//   3. Otherwise nothing. A position built only from option rows has no
//      resolvable identifier, and it must not borrow the underlying's.
//
// That third case is the one worth guarding. A filer constructs option CUSIPs
// from the underlying's, so 46438R905 and 46438R955 sit under the same prefix
// as the iShares Ethereum Trust's 46438R105. Resolving an options-only position
// through its prefix would produce a position in ETHA that the filing does not
// report. `positionsByIssuer` already keeps the values apart; this keeps the
// IDENTITY apart too.
//
// ── WHAT AN UNRESOLVED POSITION LOOKS LIKE ─────────────────────────────────
//
// `ticker: null`. Not a guess, not the issuer name lowercased, not the closest
// match. A security this app cannot identify is one it cannot price, and
// showing it unpriced is correct. Roughly 3% of JPMorgan's equity CUSIPs do not
// resolve, and they stay unresolved.
// ---------------------------------------------------------------------------

import type { IssuerPosition } from "./providers/thirteenF";
import {
  resolveIdentifiers,
  type InstrumentType,
  type SecurityIdentity,
} from "./providers/securityIdentity";

/** Which line of an issuer row the identity was resolved from. */
export type IdentityBasis = "share" | "debt" | "none";

export interface EnrichedPosition extends IssuerPosition {
  /** The identifier actually resolved, and which line it came from. */
  identifier: string | null;
  identityBasis: IdentityBasis;
  /** Null when unresolved. Never inferred from a name. */
  ticker: string | null;
  /** OpenFIGI's classification of the resolved instrument. "other" when
   *  unresolved, which is distinct from a resolved instrument we cannot type. */
  instrumentType: InstrumentType | null;
  figi: string | null;
  /** Whether ID_CUSIP or the ID_CINS fallback resolved it. */
  resolvedVia: "cusip" | "cins" | null;
}

/**
 * The identifier that represents this position, and which line it came from.
 *
 * Exported because the choice is the load-bearing part of this module and is
 * worth testing directly, without a network.
 */
export function canonicalIdentifierFor(
  p: Pick<IssuerPosition, "cusip" | "debtCusip">
): { identifier: string; basis: Exclude<IdentityBasis, "none"> } | null {
  if (p.cusip) return { identifier: p.cusip, basis: "share" };
  if (p.debtCusip) return { identifier: p.debtCusip, basis: "debt" };
  return null;
}

/**
 * Attach a canonical identity to each position.
 *
 * Enrichment is additive: it reads `cusip` and `debtCusip` and writes identity
 * fields. It does not touch shares, values, option lines or debt principal, so
 * the economic totals of a filing are the same before and after — which is
 * asserted in the tests rather than assumed.
 *
 * Callers should pass the page they are about to serve, not an entire filing.
 * A large filer reports thousands of issuers and resolving all of them would
 * spend hundreds of upstream requests to render fifty rows.
 */
export async function enrichPositions(
  positions: readonly IssuerPosition[]
): Promise<EnrichedPosition[]> {
  const chosen = positions.map((p) => canonicalIdentifierFor(p));
  const ids = chosen.filter((c): c is NonNullable<typeof c> => c !== null).map((c) => c.identifier);

  const resolved: Map<string, SecurityIdentity | null> =
    ids.length > 0 ? await resolveIdentifiers(ids) : new Map();

  return positions.map((p, i) => {
    const c = chosen[i];
    const id = c ? (resolved.get(c.identifier) ?? null) : null;
    return {
      ...p,
      identifier: c?.identifier ?? null,
      identityBasis: c?.basis ?? "none",
      ticker: id?.ticker ?? null,
      instrumentType: id?.instrument ?? null,
      figi: id?.figi ?? null,
      resolvedVia: id?.via ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Adapter to this app's existing market-data provider.
//
// `realStatsFor(symbol, kind, cgId)` in ./providers is already the single entry
// point for price, range, volume and fundamentals. This maps an instrument type
// onto the `kind` it expects rather than introducing a second provider.
// ---------------------------------------------------------------------------

/** The `kind` `realStatsFor` expects, or null when a position should not be
 *  priced as an equity at all.
 *
 * Debt is deliberately null. A convertible note has a price, but it is a bond
 * price from a bond venue, and quoting the issuer's share price beside a
 * principal amount would be a category error of exactly the kind this codebase
 * has spent its recent history removing. Options are null for the same reason:
 * the position is a right over shares, not the shares. */
export function marketDataKindFor(
  instrument: InstrumentType | null
): "stock" | "etf" | null {
  switch (instrument) {
    case "equity":
    case "adr":
    case "reit":
      return "stock";
    case "etp":
      return "etf";
    // A preferred series trades under its own symbol and does not share the
    // common's price. Resolved and displayed, but not priced as the common.
    case "preferred":
    case "bond":
    case "other":
    case null:
      return null;
  }
}

/** Everything the next stage needs to fetch market data, or null when the
 *  position is not something to price. Deliberately minimal: a ticker and the
 *  kind, which is the whole contract `realStatsFor` takes. */
export interface MarketDataTarget {
  ticker: string;
  kind: "stock" | "etf";
}

export function marketDataTargetFor(p: EnrichedPosition): MarketDataTarget | null {
  const kind = marketDataKindFor(p.instrumentType);
  if (!kind || !p.ticker) return null;
  return { ticker: p.ticker, kind };
}
