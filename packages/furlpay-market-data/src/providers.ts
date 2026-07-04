import { AssetMatch, Bar, BarInterval, BarsResult, Quote } from "./types";

/**
 * Live provider adapters. Each normalises a vendor response into the library's
 * unified {Quote, BarsResult, AssetMatch} shape. Alpha Vantage is the primary
 * source (free tier, global equities + ETFs). Nasdaq Data Link is used for
 * historical daily bars when its key is present.
 *
 * Any failure here throws; the caller (MarketData) catches and falls back to
 * deterministic demo data so a quote never comes back empty.
 */

const AV_BASE = "https://www.alphavantage.co/query";
const NASDAQ_BASE = "https://data.nasdaq.com/api/v3";

async function getJson(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    // Alpha Vantage returns 200 with a "Note"/"Information" body on rate limit.
    if (json && (json.Note || json.Information || json["Error Message"])) {
      throw new Error(json.Note || json.Information || json["Error Message"]);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

const num = (v: unknown) => Number(v);

export async function alphaVantageQuote(
  fetchImpl: typeof fetch,
  key: string,
  symbol: string,
  timeoutMs: number,
): Promise<Quote> {
  const url = `${AV_BASE}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${key}`;
  const json = await getJson(fetchImpl, url, timeoutMs);
  const q = json["Global Quote"];
  if (!q || !q["05. price"]) throw new Error("no quote in Alpha Vantage response");
  const price = num(q["05. price"]);
  const prev = num(q["08. previous close"]);
  return {
    symbol: (q["01. symbol"] || symbol).toUpperCase(),
    price,
    open: num(q["02. open"]),
    high: num(q["03. high"]),
    low: num(q["04. low"]),
    previousClose: prev,
    change: num(q["09. change"]),
    changePercent: num(String(q["10. change percent"]).replace("%", "")),
    volume: num(q["06. volume"]),
    currency: "USD",
    asOf: q["07. latest trading day"] || new Date().toISOString(),
    source: "alphavantage",
  };
}

export async function alphaVantageBars(
  fetchImpl: typeof fetch,
  key: string,
  symbol: string,
  interval: BarInterval,
  limit: number,
  timeoutMs: number,
): Promise<BarsResult> {
  const fn = interval === "daily" ? "TIME_SERIES_DAILY" : "TIME_SERIES_INTRADAY";
  const intervalParam = interval === "daily" ? "" : `&interval=${interval}`;
  const url = `${AV_BASE}?function=${fn}&symbol=${encodeURIComponent(symbol)}${intervalParam}&outputsize=compact&apikey=${key}`;
  const json = await getJson(fetchImpl, url, timeoutMs);
  const seriesKey = Object.keys(json).find((k) => k.toLowerCase().includes("time series"));
  if (!seriesKey) throw new Error("no time series in Alpha Vantage response");
  const series = json[seriesKey] as Record<string, Record<string, string>>;
  const bars: Bar[] = Object.entries(series)
    .map(([t, o]) => ({
      t: new Date(t).toISOString(),
      o: num(o["1. open"]),
      h: num(o["2. high"]),
      l: num(o["3. low"]),
      c: num(o["4. close"]),
      v: num(o["5. volume"]),
    }))
    .sort((a, b) => a.t.localeCompare(b.t))
    .slice(-limit);
  return { symbol: symbol.toUpperCase(), interval, bars, source: "alphavantage" };
}

export async function alphaVantageSearch(
  fetchImpl: typeof fetch,
  key: string,
  query: string,
  timeoutMs: number,
): Promise<AssetMatch[]> {
  const url = `${AV_BASE}?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(query)}&apikey=${key}`;
  const json = await getJson(fetchImpl, url, timeoutMs);
  const matches = (json.bestMatches || []) as Array<Record<string, string>>;
  return matches.map((m) => ({
    symbol: m["1. symbol"],
    name: m["2. name"],
    type: m["3. type"],
    region: m["4. region"],
    currency: m["8. currency"] || "USD",
    source: "alphavantage" as const,
  }));
}

export async function nasdaqDailyBars(
  fetchImpl: typeof fetch,
  key: string,
  symbol: string,
  limit: number,
  timeoutMs: number,
): Promise<BarsResult> {
  // WIKI/EOD-style dataset shape: { dataset: { data: [[date, open, high, low, close, volume], ...] } }
  const url = `${NASDAQ_BASE}/datasets/EOD/${encodeURIComponent(symbol.toUpperCase())}.json?rows=${limit}&api_key=${key}`;
  const json = await getJson(fetchImpl, url, timeoutMs);
  const rows = json?.dataset?.data as unknown[][] | undefined;
  if (!rows || !rows.length) throw new Error("no dataset rows from Nasdaq Data Link");
  const bars: Bar[] = rows
    .map((row) => ({
      t: new Date(String(row[0])).toISOString(),
      o: num(row[1]),
      h: num(row[2]),
      l: num(row[3]),
      c: num(row[4]),
      v: num(row[5]),
    }))
    .sort((a, b) => a.t.localeCompare(b.t));
  return { symbol: symbol.toUpperCase(), interval: "daily", bars, source: "nasdaq" };
}
