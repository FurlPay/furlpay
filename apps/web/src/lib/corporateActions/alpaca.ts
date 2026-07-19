import type { CorporateAction } from "./types";

// ---------------------------------------------------------------------------
// Alpaca Market Data — Corporate Actions ingestion.
//
//   GET https://data.alpaca.markets/v1/corporate-actions   (v1, NOT v1beta1)
//
// Reuses the SAME credentials as market quotes (ALPACA_API_KEY_ID /
// ALPACA_API_SECRET_KEY) — see lib/markets/quotes.ts. Mock-by-default: with no
// keys the fetch returns null and the caller no-ops, so the app still runs end
// to end at zero cost (repo convention).
//
// Idempotency: Alpaca's own action `id` becomes corporate_actions.id (the PK),
// so a re-run upserts in place rather than duplicating. The raw provider row is
// carried through to corporate_actions.metadata for later reconciliation.
//
// Only the action types the projector actually applies are emitted — splits,
// cash dividends and renames. Mergers / spin-offs / stock dividends are ignored
// in v1 rather than stored as rows nothing consumes yet.
// ---------------------------------------------------------------------------

const DATA_BASE = process.env.ALPACA_DATA_BASE || "https://data.alpaca.markets";
const FETCH_TIMEOUT_MS = 15_000;
const SYMBOLS_PER_REQUEST = 100; // keeps the query string well under URL limits
const MAX_PAGES = 50; // hard bound so a runaway page_token can't loop forever

// Alpaca corporate-actions history begins here; a wider `start` is clamped by
// the API anyway. Exposed so callers don't have to hardcode it.
export const ALPACA_CA_HISTORY_START = "2020-04-01";

export interface NormalizedAction {
  action: CorporateAction;
  /** Raw provider payload → corporate_actions.metadata for reconciliation. */
  raw: unknown;
}

type Row = Record<string, unknown>;

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Split ratio as new-for-old: a 4-for-1 split is old_rate 1, new_rate 4 → 4. */
function splitRatio(r: Row): number | undefined {
  const oldR = num(r.old_rate);
  const newR = num(r.new_rate);
  if (!oldR || !newR || oldR <= 0 || newR <= 0) return undefined;
  return newR / oldR;
}

/**
 * Map an Alpaca corporate-actions payload into the canonical model. Pure — no
 * network — so it is unit-testable against fixtures. Rows missing the fields a
 * type requires (a split with no usable ratio, a dividend with no rate) are
 * dropped rather than stored malformed.
 */
export function normalizeAlpacaCorporateActions(payload: Row): NormalizedAction[] {
  const ca = (payload?.corporate_actions ?? {}) as Row;
  const out: NormalizedAction[] = [];
  const arr = (k: string): Row[] => (Array.isArray(ca[k]) ? (ca[k] as Row[]) : []);
  const base = (r: Row) => ({ id: String(r.id), source: "alpaca" as const, confidence: "confirmed" as const });

  for (const r of arr("forward_splits")) {
    const ratio = splitRatio(r);
    if (!r.id || !r.symbol || !r.ex_date || !ratio) continue;
    out.push({
      raw: r,
      action: {
        ...base(r),
        symbol: String(r.symbol),
        type: "stock_split",
        effectiveDate: String(r.ex_date),
        ...(r.record_date ? { recordDate: String(r.record_date) } : {}),
        ...(r.payable_date ? { paymentDate: String(r.payable_date) } : {}),
        ratio,
      },
    });
  }

  for (const r of arr("reverse_splits")) {
    const ratio = splitRatio(r);
    if (!r.id || !r.symbol || !r.ex_date || !ratio) continue;
    out.push({
      raw: r,
      action: {
        ...base(r),
        symbol: String(r.symbol),
        type: "reverse_split",
        effectiveDate: String(r.ex_date),
        ...(r.record_date ? { recordDate: String(r.record_date) } : {}),
        ...(r.payable_date ? { paymentDate: String(r.payable_date) } : {}),
        ratio,
        ...(r.new_symbol ? { newSymbol: String(r.new_symbol) } : {}),
      },
    });
  }

  for (const r of arr("cash_dividends")) {
    const rate = num(r.rate);
    if (!r.id || !r.symbol || !r.ex_date || rate == null || rate < 0) continue;
    out.push({
      raw: r,
      action: {
        ...base(r),
        symbol: String(r.symbol),
        type: "cash_dividend",
        effectiveDate: String(r.ex_date),
        ...(r.record_date ? { recordDate: String(r.record_date) } : {}),
        ...(r.payable_date ? { paymentDate: String(r.payable_date) } : {}),
        amountPerShare: rate,
      },
    });
  }

  for (const r of arr("name_changes")) {
    if (!r.id || !r.old_symbol || !r.new_symbol || !r.process_date) continue;
    out.push({
      raw: r,
      action: {
        ...base(r),
        symbol: String(r.old_symbol),
        type: "symbol_change",
        effectiveDate: String(r.process_date),
        newSymbol: String(r.new_symbol),
      },
    });
  }

  return out;
}

async function fetchPage(
  headers: Record<string, string>,
  symbols: string[],
  start: string,
  end: string,
  pageToken?: string,
): Promise<{ actions: NormalizedAction[]; next?: string }> {
  const params = new URLSearchParams({
    symbols: symbols.join(","),
    types: "forward_split,reverse_split,cash_dividend,name_change",
    start,
    end,
    limit: "1000",
  });
  if (pageToken) params.set("page_token", pageToken);

  const res = await fetch(`${DATA_BASE}/v1/corporate-actions?${params}`, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Alpaca corporate-actions ${res.status}`);
  const json = (await res.json()) as Row;
  return {
    actions: normalizeAlpacaCorporateActions(json),
    next: typeof json?.next_page_token === "string" ? json.next_page_token : undefined,
  };
}

/**
 * Fetch + normalize corporate actions for symbols over a date range. Chunks
 * symbols (100/request) and follows next_page_token within each chunk.
 *
 * Returns null when Alpaca keys are not configured — the mock-by-default
 * posture — so callers can tell "not wired" apart from "genuinely none".
 */
export async function fetchAlpacaCorporateActions(opts: {
  symbols: string[];
  start: string;
  end: string;
}): Promise<NormalizedAction[] | null> {
  const key = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!key || !secret) return null;

  const symbols = [...new Set(opts.symbols.map((s) => s.toUpperCase()))].filter(Boolean);
  if (!symbols.length) return [];

  const headers = { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret };
  const out: NormalizedAction[] = [];

  for (let i = 0; i < symbols.length; i += SYMBOLS_PER_REQUEST) {
    const chunk = symbols.slice(i, i + SYMBOLS_PER_REQUEST);
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const { actions, next } = await fetchPage(headers, chunk, opts.start, opts.end, pageToken);
      out.push(...actions);
      if (!next) break;
      pageToken = next;
    }
  }
  return out;
}
