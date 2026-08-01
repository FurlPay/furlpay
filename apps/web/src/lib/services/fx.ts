// ---------------------------------------------------------------------------
// FX & fiat off-ramp routing (Blueprint §4.5).
// LIVE: real mid-market rates from Frankfurter (ECB reference rates, free, no
//       key), plus local fast-payment rails (UPI / Pix / SEPA Instant / FedNow).
// FALLBACK: a static reference table if the rate API is unreachable, so the
//           endpoint never fails — the response marks which source was used.
//
// WHAT THE RATES ARE, AND WHAT THEY ARE NOT. The ECB publishes euro reference
// rates once per working day at around 16:00 CET, and not at all on TARGET
// closing days — so a rate read on a Sunday is Friday's, which is normal and
// not an error. The ECB also states that the reference rates are published for
// information purposes only and that using them for transaction purposes is
// strongly discouraged. Everything here is therefore an INDICATIVE mid-market
// rate. `rateDate` is returned so a client can say how old it is; clients are
// expected to show that rather than imply the user will be dealt this price.
// https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html
// ---------------------------------------------------------------------------

// Reference mid-market rates vs USD — used only when the live API is down.
//
// These are a LAST-KNOWN floor, not a source of truth: they were written by
// hand and do not move. `source: "reference"` on the quote is how a caller
// tells them apart from a live rate, and it is not decoration — the native and
// iOS clients both surface it as a warning rather than rendering the number as
// a normal quote.
const REFERENCE_MID: Record<string, number> = {
  USD: 1,
  EUR: 0.917,
  GBP: 0.786,
  INR: 83.4,
  BRL: 5.42,
  JPY: 157,
  AED: 3.67,
  SGD: 1.35,
};

const WISE_FEE_PCT = 0.4; // flat, transparent

// Frankfurter v2. v1 still works and is not deprecated, but v2 is the current
// surface and is the one that can be pinned to a provider.
//
// `providers=ecb` is load-bearing, not tidiness: v2 defaults to a BLENDED rate
// across the ~84 central banks it tracks, so calling it without this would
// quietly stop returning the ECB reference rates the comment above promises and
// the fallback table is denominated against. Frankfurter's own guidance is to
// filter by provider when the exact reference series matters.
// Note the v1 -> v2 parameter rename: `symbols` became `quotes`.
const FX_API = "https://api.frankfurter.dev/v2/rates";
const FX_PROVIDER = "ecb";
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface FxQuote {
  from: string;
  to: string;
  amountFrom: number;
  midMarketRate: number;
  feePct: number;
  feeAmount: number;
  amountTo: number;
  rail: string;
  savingsVsCompetitorPct: number;
  source: "live" | "reference";
  rateDate?: string;
}

const RAILS: Record<string, string> = {
  INR: "UPI",
  BRL: "Pix",
  EUR: "SEPA Instant",
  USD: "FedNow / RTP",
  GBP: "Faster Payments",
  SGD: "PayNow",
  AED: "Aani",
};

// Per-base rate cache: base → { at, rates, date }.
//
// `date` is cached alongside the rates because it is the rate's PUBLICATION
// day, not the fetch time — dropping it on a cache hit made an ECB rate look
// undated to the client, which is the one thing that lets a Friday rate read as
// a live one on a Sunday.
const cache = new Map<string, { at: number; rates: Record<string, number>; date?: string }>();

async function liveRate(from: string, to: string): Promise<{ rate: number; date?: string } | null> {
  if (from === to) return { rate: 1 };
  const cached = cache.get(from);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS && cached.rates[to] != null) {
    return { rate: cached.rates[to], date: cached.date };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const url =
      `${FX_API}?base=${encodeURIComponent(from)}` +
      `&providers=${FX_PROVIDER}` +
      // Ask for every currency we can price, not just `to`: one call then fills
      // the cache for the whole session's pairs off the same base.
      `&quotes=${encodeURIComponent(Object.keys(REFERENCE_MID).join(","))}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;

    // v2 answers with a FLAT ARRAY of records, not v1's { rates: {...}, date }:
    //
    //   [{ "date":"2026-07-31", "base":"USD", "quote":"BRL", "rate":5.0583 }, …]
    //
    // Reading it as `json.rates` yields undefined on every call, which does not
    // throw — it just returns null forever and pins every quote to the stale
    // fallback table while still reporting a plausible number. Verified against
    // the live endpoint rather than assumed.
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const rates: Record<string, number> = {};
    let date: string | undefined;
    for (const row of rows as Array<{ quote?: string; rate?: number; date?: string }>) {
      if (typeof row?.quote === "string" && typeof row.rate === "number") {
        rates[row.quote] = row.rate;
        date ??= row.date;
      }
    }
    if (Object.keys(rates).length === 0) return null;

    cache.set(from, { at: Date.now(), rates, date });
    const rate = rates[to];
    // A pair the provider does not publish (the ECB has no AED series, for
    // instance) is a miss, not a failure — the caller falls back and labels it.
    return rate != null ? { rate, date } : null;
  } catch {
    return null;
  }
}

function referenceRate(from: string, to: string): number {
  const rf = REFERENCE_MID[from];
  const rt = REFERENCE_MID[to];
  if (!rf || !rt) throw new Error(`Unsupported currency pair ${from}/${to}`);
  return rt / rf;
}

export async function quoteFx(from: string, to: string, amountFrom: number): Promise<FxQuote> {
  const live = await liveRate(from, to);
  const midMarketRate = live ? live.rate : referenceRate(from, to);
  const feeAmount = amountFrom * (WISE_FEE_PCT / 100);
  const amountTo = (amountFrom - feeAmount) * midMarketRate;

  return {
    from,
    to,
    amountFrom,
    midMarketRate: round(midMarketRate, 4),
    feePct: WISE_FEE_PCT,
    feeAmount: round(feeAmount, 2),
    amountTo: round(amountTo, 2),
    rail: RAILS[to] ?? "SWIFT",
    // RedotPay/Bridge charge ~1.5-2% all-in; we save the difference.
    savingsVsCompetitorPct: round(((1.7 - WISE_FEE_PCT) / 1.7) * 100, 0),
    source: live ? "live" : "reference",
    rateDate: live?.date,
  };
}

function round(n: number, dp = 2): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
