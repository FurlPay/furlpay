// ---------------------------------------------------------------------------
// FX & fiat off-ramp routing (Blueprint §4.5).
// LIVE: real mid-market rates from Frankfurter (ECB reference rates, free, no
//       key), plus local fast-payment rails (UPI / Pix / SEPA Instant / FedNow).
// FALLBACK: a static reference table if the rate API is unreachable, so the
//           endpoint never fails — the response marks which source was used.
// ---------------------------------------------------------------------------

// Reference mid-market rates vs USD — used only when the live API is down.
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

const FX_API = "https://api.frankfurter.dev/v1/latest";
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

// Per-base rate cache: base → { at, rates }.
const cache = new Map<string, { at: number; rates: Record<string, number> }>();

async function liveRate(from: string, to: string): Promise<{ rate: number; date?: string } | null> {
  if (from === to) return { rate: 1 };
  const cached = cache.get(from);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS && cached.rates[to] != null) {
    return { rate: cached.rates[to] };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${FX_API}?base=${encodeURIComponent(from)}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = (await res.json()) as { rates?: Record<string, number>; date?: string };
    if (!json.rates) return null;
    cache.set(from, { at: Date.now(), rates: json.rates });
    const rate = json.rates[to];
    return rate != null ? { rate, date: json.date } : null;
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
