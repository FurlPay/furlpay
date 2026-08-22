// ---------------------------------------------------------------------------
// Yahoo Finance v7 batch quote — the one keyless source that returns market
// cap and session volume for MANY equities in a single round trip.
//
// Why this exists at all. The markets table has a Market Cap and a Volume
// column, and until now neither could be filled for a stock: the v8 chart
// endpoint (providers/yahoo.ts) carries volume but not shares outstanding, and
// the only other real source for a share count is SEC `companyfacts` — a
// multi-megabyte JSON per company, which is the right answer for ONE ticker's
// detail page and an impossible one for a 25-row list.
//
// v7/finance/quote answers all of it for up to a hundred symbols at once, but
// since mid-2026 it rejects unauthenticated callers with 401 "Invalid Crumb".
// The credential is not an API key and there is nothing to sign up for: a GET
// to fc.yahoo.com sets a session cookie, and /v1/test/getcrumb turns that
// cookie into a short opaque token that must accompany every query. That pair
// is what this module manages.
//
// Discipline, because this is undocumented and shared:
//   - One crumb per process, reused until it is rejected. Re-minting per
//     request would triple the traffic for no benefit.
//   - A 401 invalidates the cached crumb and is retried EXACTLY once, so an
//     expired credential self-heals without turning into a retry storm.
//   - Every failure returns an empty map. A caller that gets nothing renders
//     an em-dash; nothing here may throw a page down or invent a number.
// ---------------------------------------------------------------------------

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 6_000;
/** Yahoo accepts long symbol lists; 100 keeps each URL well inside limits. */
const CHUNK = 100;
/** A crumb outlives a single request but not a deploy. Re-mint hourly. */
const CRUMB_TTL_MS = 60 * 60 * 1000;

export interface BatchQuote {
  symbol: string;
  price: number | null;
  changePct: number | null;
  /** Shares outstanding × price, as Yahoo reports it. Absent for ETFs, which
   *  report net assets rather than a market capitalisation — null, not 0. */
  marketCap: number | null;
  /** Shares traded this session. */
  volume: number | null;
  currency: string | null;
}

interface Credential {
  cookie: string;
  crumb: string;
  mintedAt: number;
}

// Module-level, so every request on this instance shares one credential.
const g = globalThis as unknown as { __yahooCrumb?: Credential | null };

/** Mint a fresh cookie + crumb pair. Null when either step fails. */
async function mintCredential(): Promise<Credential | null> {
  try {
    const seed = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": UA, Accept: "*/*" },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    // getSetCookie() is the only way to read MULTIPLE Set-Cookie headers; the
    // single-header get() collapses them and loses the session cookie.
    const cookie = seed.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .filter(Boolean)
      .join("; ");
    if (!cookie) return null;

    const res = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Accept: "*/*", cookie },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const crumb = (await res.text()).trim();
    // A crumb is a short opaque token. An HTML error page is not one.
    if (!crumb || crumb.length > 64 || crumb.includes("<")) return null;
    return { cookie, crumb, mintedAt: Date.now() };
  } catch {
    return null;
  }
}

async function credential(force = false): Promise<Credential | null> {
  const cached = g.__yahooCrumb;
  if (!force && cached && Date.now() - cached.mintedAt < CRUMB_TTL_MS) return cached;
  const fresh = await mintCredential();
  g.__yahooCrumb = fresh;
  return fresh;
}

interface RawQuote {
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  marketCap?: number;
  regularMarketVolume?: number;
  currency?: string;
}

function positive(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/** One chunk. `retried` guards the single re-mint on a rejected crumb. */
async function fetchChunk(symbols: string[], retried = false): Promise<RawQuote[]> {
  const cred = await credential(retried);
  if (!cred) return [];

  const url =
    "https://query1.finance.yahoo.com/v7/finance/quote" +
    `?symbols=${encodeURIComponent(symbols.join(","))}` +
    `&crumb=${encodeURIComponent(cred.crumb)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "*/*", cookie: cred.cookie },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return [];
  }

  // The crumb expired or the cookie was rotated. Mint once and retry; a second
  // 401 means the endpoint changed shape and we simply have no data.
  if ((res.status === 401 || res.status === 403) && !retried) {
    g.__yahooCrumb = null;
    return fetchChunk(symbols, true);
  }
  if (!res.ok) return [];

  try {
    const json = (await res.json()) as { quoteResponse?: { result?: RawQuote[] } };
    return json.quoteResponse?.result ?? [];
  } catch {
    return [];
  }
}

/**
 * Quotes for many Yahoo symbols, keyed by the symbol Yahoo echoed back.
 *
 * Callers pass YAHOO spellings (BRK-B, not BRK.B — see yahooSymbolFor) and are
 * responsible for mapping back to catalog symbols. Missing symbols are simply
 * absent from the map rather than present with zeroes.
 */
export async function batchQuotes(symbols: string[]): Promise<Map<string, BatchQuote>> {
  const out = new Map<string, BatchQuote>();
  if (symbols.length === 0) return out;

  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += CHUNK) chunks.push(symbols.slice(i, i + CHUNK));

  // Sequential: this is a shared, undocumented, IP-rate-limited endpoint, and
  // four parallel hundred-symbol queries is exactly the traffic shape that
  // gets an IP throttled. Three or four round trips covers the whole catalog.
  for (const chunk of chunks) {
    for (const raw of await fetchChunk(chunk)) {
      if (!raw.symbol) continue;
      out.set(raw.symbol, {
        symbol: raw.symbol,
        price: positive(raw.regularMarketPrice),
        changePct:
          typeof raw.regularMarketChangePercent === "number" &&
          Number.isFinite(raw.regularMarketChangePercent)
            ? raw.regularMarketChangePercent
            : null,
        marketCap: positive(raw.marketCap),
        volume: typeof raw.regularMarketVolume === "number" && raw.regularMarketVolume >= 0
          ? raw.regularMarketVolume
          : null,
        currency: raw.currency ?? null,
      });
    }
  }
  return out;
}

/** Test seam: drop the cached credential so a spec starts from a cold state. */
export function __resetCredential(): void {
  g.__yahooCrumb = null;
}
