// ---------------------------------------------------------------------------
// FX & fiat off-ramp routing (Blueprint §4.5, Playbook Gap 2).
// LIVE: Wise Business API — mid-market rate + flat 0.3–0.5% fee, plus local
// fast-payment rails (UPI / Pix / SEPA Instant / FedNow).
// MOCK: mid-market table + transparent flat fee.
// ---------------------------------------------------------------------------

// Mid-market rates vs USD (illustrative, 2026).
const MID_MARKET: Record<string, number> = {
  USD: 1,
  EUR: 0.917,
  GBP: 0.786,
  INR: 83.4,
  BRL: 5.42,
};

const WISE_FEE_PCT = 0.4; // flat, transparent

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
}

const RAILS: Record<string, string> = {
  INR: "UPI",
  BRL: "Pix",
  EUR: "SEPA Instant",
  USD: "FedNow / RTP",
  GBP: "Faster Payments",
};

export function quoteFx(from: string, to: string, amountFrom: number): FxQuote {
  const rf = MID_MARKET[from];
  const rt = MID_MARKET[to];
  if (!rf || !rt) throw new Error(`Unsupported currency pair ${from}/${to}`);

  const midMarketRate = rt / rf;
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
  };
}

function round(n: number, dp = 2): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
