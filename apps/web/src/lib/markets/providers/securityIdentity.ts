// ---------------------------------------------------------------------------
// Canonical security identity: CUSIP -> ticker, without ever matching a name.
//
// This is the layer every institutional-flow feature needs and the one this app
// did not have. A 13F identifies securities by CUSIP; market data is keyed by
// ticker; and the gap between them has, until now, been unbridgeable here
// without guessing. Guessing is what we refused to do, and correctly: matching
// on issuer name is how "RIOT" finds MARRIOTT, "MARA" finds MARATHON PETROLEUM
// and a search for "CIPHER MINING" misses CIPHER DIGITAL INC entirely.
//
// The bridge is OpenFIGI, Bloomberg's open symbology service. It accepts an
// identifier and returns the instruments it identifies. It is free and
// unauthenticated, and it never sees a company name from us.
//
// ── TWO IDENTIFIER TYPES, NOT ONE ──────────────────────────────────────────
//
// A first pass using ID_CUSIP alone resolved 96.72% of JPMorgan's Q2 2026
// equity value and failed with a perfectly systematic signature: every miss in
// the top 150 was a CINS, the international extension of CUSIP, whose codes
// begin with a letter — G for Ireland and Bermuda, N for the Netherlands, F for
// France, Q for Australia. Eaton, Trane, Seagate, NXP, ASML, Aon, AstraZeneca,
// Linde and TotalEnergies were all invisible, about $41bn of the top 150 alone,
// and so was IREN Limited under Q4982L109.
//
// OpenFIGI exposes ID_CINS separately, and it resolves all ten of those. So the
// resolver tries ID_CUSIP and falls back to ID_CINS. Neither call is a search:
// both are exact identifier lookups.
//
// ── WHAT THIS DELIBERATELY DOES NOT RESOLVE ────────────────────────────────
//
// Option rows. A filer constructs an option CUSIP from the underlying's — the
// iShares Ethereum Trust's shares are 46438R105 while its calls and puts are
// 46438R905 and 46438R955 — and those synthetic codes identify no instrument.
// OpenFIGI returns nothing for them, which is correct. An option row is
// resolved through the share line of the same issuer, never on its own CUSIP.
//
// A miss is returned as null. It is never backfilled from an issuer name, and
// a caller that cannot resolve a security should show it unresolved rather than
// attach it to whatever the name happens to look like.
// ---------------------------------------------------------------------------

import { cachedJson } from "./cache";

const OPENFIGI = "https://api.openfigi.com/v3/mapping";

/** A resolved mapping is effectively immutable: a CUSIP is not reassigned to a
 *  different security. Cached for 30 days, and the negative answer with it —
 *  re-asking OpenFIGI for the same unresolvable option CUSIP on every request
 *  is how a free service stops being free. */
const TTL_IDENTITY = 2_592_000;

/** OpenFIGI rejects a request carrying more than ten mapping jobs. */
export const FIGI_BATCH = 10;

export type InstrumentType =
  | "equity"
  | "etp"
  | "adr"
  | "reit"
  | "preferred"
  | "bond"
  | "other";

export interface SecurityIdentity {
  /** The identifier as filed, upper-cased. */
  cusip: string;
  ticker: string;
  /** OpenFIGI's own securityType string, kept verbatim for auditability. */
  securityType: string;
  exchCode: string | null;
  /** Which identifier type resolved it — useful when diagnosing coverage. */
  via: "cusip" | "cins";
  /** Our coarse classification of securityType. */
  instrument: InstrumentType;
  figi: string | null;
}

/** Map OpenFIGI's securityType onto something a surface can branch on.
 *
 * The distinction that matters is between an equity line and everything that
 * is NOT one. OpenFIGI independently confirms the classification we derive
 * from the filing itself: Strategy's convertible note CUSIP 594972AJ0 comes
 * back as "MSTR 0.625 03/15/30" on TRACE, and its preferred 594972887 as
 * "MSTR 8 PERP" — neither of which is the common stock a reader means by
 * "Strategy". Two independent sources agreeing on that split is the strongest
 * evidence we have that the SH/PRN handling is right. */
export function classifyInstrument(securityType: string, exchCode: string | null): InstrumentType {
  const t = securityType.toUpperCase();
  if (t === "ETP" || t.includes("ETF") || t.includes("FUND")) return "etp";
  if (t === "ADR" || t.includes("DEPOSITARY")) return "adr";
  if (t === "REIT") return "reit";
  if (t.includes("PREF") || t.includes("PERP")) return "preferred";
  // TRACE is the bond reporting facility; anything quoted there is debt,
  // whatever its securityType string says.
  if (exchCode === "TRACE" || t.includes("BOND") || t.includes("NOTE") || t === "US DOMESTIC") {
    return "bond";
  }
  // An MLP unit and a New York registered share are listed, quoted and priced
  // like common stock. Found in the reconciliation against JPMorgan's filing,
  // where both appear in the top 300 positions and would otherwise have fallen
  // through to "other" and never been priced.
  if (t === "MLP" || t.includes("COMMON") || t.includes("SHRS") || t.includes("SHARE")) {
    return "equity";
  }
  return "other";
}

interface FigiRecord {
  figi?: string;
  ticker?: string;
  exchCode?: string;
  securityType?: string;
}
interface FigiResult {
  data?: FigiRecord[];
  warning?: string;
  error?: string;
}

async function mapBatch(
  idType: "ID_CUSIP" | "ID_CINS",
  ids: readonly string[]
): Promise<(FigiRecord | null)[]> {
  try {
    const res = await fetch(OPENFIGI, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids.map((idValue) => ({ idType, idValue }))),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    // 429 is the unauthenticated rate limit. Returning nulls degrades this
    // batch to "unresolved" rather than throwing; the cache means a retry on
    // the next request costs one call, not the whole set.
    if (!res.ok) return ids.map(() => null);
    const out = (await res.json()) as FigiResult[];
    return ids.map((_, i) => {
      const d = out[i]?.data;
      if (!d?.length) return null;
      // Prefer the US composite listing. A single security is listed on many
      // venues and the US line is the one our price data is keyed to.
      return d.find((r) => r.exchCode === "US") ?? d[0]!;
    });
  } catch {
    return ids.map(() => null);
  }
}

function toIdentity(
  cusip: string,
  rec: FigiRecord | null,
  via: "cusip" | "cins"
): SecurityIdentity | null {
  if (!rec?.ticker) return null;
  const securityType = rec.securityType ?? "";
  const exchCode = rec.exchCode ?? null;
  return {
    cusip,
    ticker: rec.ticker,
    securityType,
    exchCode,
    via,
    instrument: classifyInstrument(securityType, exchCode),
    figi: rec.figi ?? null,
  };
}

/**
 * Resolve many identifiers at once. Order of the result matches the input.
 *
 * Batched at ten per request because OpenFIGI refuses more, and the CINS
 * fallback only runs for the identifiers ID_CUSIP could not resolve — which is
 * a small minority, so it costs little.
 */
export async function resolveIdentifiers(
  cusips: readonly string[]
): Promise<Map<string, SecurityIdentity | null>> {
  const out = new Map<string, SecurityIdentity | null>();
  const wanted: string[] = [];

  for (const raw of cusips) {
    const c = raw.trim().toUpperCase();
    if (!c || out.has(c)) continue;
    out.set(c, null);
    wanted.push(c);
  }

  const unresolvedAfterCusip: string[] = [];
  for (let i = 0; i < wanted.length; i += FIGI_BATCH) {
    const chunk = wanted.slice(i, i + FIGI_BATCH);
    const recs = await mapBatch("ID_CUSIP", chunk);
    chunk.forEach((c, k) => {
      const id = toIdentity(c, recs[k] ?? null, "cusip");
      if (id) out.set(c, id);
      else unresolvedAfterCusip.push(c);
    });
  }

  // The CINS pass. Without it, every Irish, Dutch, French and Australian
  // issuer in a US institutional portfolio is unresolvable.
  for (let i = 0; i < unresolvedAfterCusip.length; i += FIGI_BATCH) {
    const chunk = unresolvedAfterCusip.slice(i, i + FIGI_BATCH);
    const recs = await mapBatch("ID_CINS", chunk);
    chunk.forEach((c, k) => {
      const id = toIdentity(c, recs[k] ?? null, "cins");
      if (id) out.set(c, id);
    });
  }

  return out;
}

/** Resolve one identifier, cached. Null means genuinely unresolved — an option
 *  CUSIP, a private placement, or a security OpenFIGI does not carry. */
export async function resolveIdentifier(cusip: string): Promise<SecurityIdentity | null> {
  const c = cusip.trim().toUpperCase();
  if (!c) return null;
  // The negative answer is cached too, deliberately: the alternative is asking
  // an unauthenticated service the same unanswerable question forever.
  const hit = await cachedJson<{ id: SecurityIdentity | null }>(
    `figi:v1:${c}`,
    TTL_IDENTITY,
    async () => ({ id: (await resolveIdentifiers([c])).get(c) ?? null })
  );
  return hit?.id ?? null;
}
