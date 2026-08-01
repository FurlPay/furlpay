import { useQuery } from "@tanstack/react-query";
import { api, ApiError, NetworkError } from "./api";

// ---------------------------------------------------------------------------
// Foreign exchange rates — from the server, never from a table in this file.
//
// WHAT THIS REPLACES. app/banking.tsx carried its own rate table:
//
//   const TO_USD = { USD: 1, EUR: 1.09, GBP: 1.27, INR: 0.012, JPY: 0.0064 };
//
// and multiplied by it to fill a row labelled "Indicative rate". Two separate
// problems, and the second is the one that matters:
//
//   1. Those numbers were written down once and never moved again. EUR at 1.09
//      and INR at 0.012 are roughly 2024 levels. A rate table is not a constant.
//   2. It was fabricated data wearing the label of a market rate. The screen's
//      PreviewBanner says "no real money will move", which is true and is about
//      EXECUTION — it says nothing about the number beside it, and a user
//      reading "1 EUR = 1.0900 USD" has no way to tell it came from a literal.
//
// A wrong rate that admits it is wrong is recoverable. A wrong rate presented
// as a quote is not, so there is deliberately no local fallback here: when the
// server cannot price a pair, callers get an error and show it. See
// `FxUnavailable`.
//
// PROVENANCE. /api/offramp prices through lib/services/fx.ts, which reads the
// European Central Bank's euro reference rates via Frankfurter. Two properties
// of that source that the UI has to respect rather than hide:
//
//   * They are published once per working day, around 16:00 CET, and not at all
//     on TARGET closing days. A rate fetched on a Sunday is Friday's. Hence
//     `rateDate` and `isStale` below.
//   * The ECB states plainly that the reference rates are "published for
//     information purposes only" and that "using the rates for transaction
//     purposes is strongly discouraged".
//
// So this is an indicative mid-market rate and must be labelled as one. It is
// not a dealt rate and nothing here should imply the user will receive it.
// ---------------------------------------------------------------------------

/** Currencies /api/offramp can price. Mirrors REFERENCE_MID in services/fx.ts. */
export const FX_CURRENCIES = ["USD", "EUR", "GBP", "INR", "BRL", "JPY", "AED", "SGD"] as const;
export type FxCurrency = (typeof FX_CURRENCIES)[number];

export interface FxQuote {
  from: string;
  to: string;
  amountFrom: number;
  /** Mid-market, indicative. Not a dealt rate — see the file header. */
  midMarketRate: number;
  feePct: number;
  feeAmount: number;
  amountTo: number;
  /** Local rail the payout would use ("UPI", "SEPA Instant", …). */
  rail: string;
  savingsVsCompetitorPct: number;
  /**
   * `live` — fetched from the rate API just now (or within its 10-minute cache).
   * `reference` — the API was unreachable and the server fell back to its own
   * stored table. Callers MUST surface this rather than treating the two alike;
   * a reference rate is a last-known figure of unstated age, and presenting it
   * as a live quote is exactly the bug this module exists to remove.
   */
  source: "live" | "reference";
  /** ISO date the rate was published (ECB working day), when known. */
  rateDate?: string;
}

/** Why a rate could not be shown. Callers render `message` verbatim. */
export class FxUnavailable extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "FxUnavailable";
    this.retryable = retryable;
  }
}

/**
 * One indicative quote. `execute: false` — this asks the price and moves
 * nothing.
 */
export async function fetchFxQuote(
  from: string,
  to: string,
  amount: number,
  signal?: AbortSignal
): Promise<FxQuote> {
  try {
    const res = await api<{ quote: FxQuote }>("/offramp", {
      method: "POST",
      body: { fromCurrency: from, toCurrency: to, amount, execute: false },
      signal,
    });
    if (!res?.quote || typeof res.quote.midMarketRate !== "number") {
      throw new FxUnavailable("The server did not return a usable rate.", true);
    }
    return res.quote;
  } catch (e) {
    if (e instanceof FxUnavailable) throw e;
    if (e instanceof NetworkError) {
      throw new FxUnavailable("You're offline, so we can't price this right now.", true);
    }
    if (e instanceof ApiError) {
      // 400 is an unsupported pair — retrying sends the identical body and
      // fails identically, so don't offer it.
      throw new FxUnavailable(
        e.status === 400 ? "We can't convert between those currencies yet." : e.message,
        e.status >= 500
      );
    }
    throw e;
  }
}

/**
 * How old a published rate is, in whole days, or null if undated.
 *
 * Weekend and holiday gaps are normal for ECB reference rates and are NOT an
 * error — but a two-day-old rate should say so rather than read as current.
 */
export function rateAgeDays(rateDate: string | undefined, now = new Date()): number | null {
  if (!rateDate) return null;
  const published = new Date(`${rateDate}T00:00:00Z`);
  if (Number.isNaN(published.getTime())) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((today - published.getTime()) / 86_400_000));
}

/** One line of provenance for the quote, always shown next to the rate. */
export function fxProvenance(quote: FxQuote, now = new Date()): string {
  if (quote.source === "reference") {
    return "Rate source unavailable — showing a stored reference rate, not a live one.";
  }
  const age = rateAgeDays(quote.rateDate, now);
  if (age === null) return "Indicative mid-market rate. Not a dealt rate.";
  if (age === 0) return "Indicative mid-market rate, published today (ECB).";
  if (age === 1) return "Indicative mid-market rate, published yesterday (ECB).";
  return `Indicative mid-market rate, published ${age} days ago (ECB).`;
}

/**
 * Live quote for the Convert flow.
 *
 * `staleTime` is 60s and the key includes the amount, so typing re-prices
 * without hammering the route (which is user-rate-limited server-side).
 * Disabled for a zero amount or a same-currency pair — neither is a question
 * worth asking the server.
 */
export function useFxQuote(from: string, to: string, amount: number) {
  return useQuery({
    queryKey: ["fx", from, to, amount],
    queryFn: ({ signal }) => fetchFxQuote(from, to, amount, signal),
    enabled: amount > 0 && from !== to && !!from && !!to,
    staleTime: 60_000,
    // A 400 for an unsupported pair is not worth a second identical request.
    retry: (count, error) => error instanceof FxUnavailable && error.retryable && count < 2,
  });
}
