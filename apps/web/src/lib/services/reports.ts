import type { UserAccount } from "@/lib/store";
import type { Transaction } from "@/lib/types";

// ---------------------------------------------------------------------------
// Unified P&L + tax reporting across the whole FurlPay account: equities
// (Alpaca holdings, marked to market vs cost basis), crypto disposals (swaps /
// card spend / sells recorded in the ledger) and travel cashback. This is the
// "one report for stocks + crypto + rewards" angle — Koinly does crypto only,
// brokers do equities only.
//
// Demo caveat: crypto cost-basis lots aren't tracked per-acquisition in the
// in-memory store, so realized crypto P&L is estimated at a flat basis ratio.
// The CSV export lists the underlying disposal events so it round-trips into a
// real tax tool; a live build sources lots from the ledger.
// ---------------------------------------------------------------------------

const CRYPTO_BASIS_RATIO = 0.92; // assumed avg acquisition cost vs current value

export interface PnlReport {
  generatedAt: string;
  equities: {
    marketValue: number;
    costBasis: number;
    unrealizedPnl: number;
    positions: { symbol: string; marketValue: number; costBasis: number; unrealizedPnl: number }[];
  };
  crypto: { realizedPnl: number; disposalCount: number; proceeds: number };
  cashback: { total: number; count: number };
  totalPnl: number;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A disposal (taxable-ish) event: something that realizes gain/loss. */
export interface DisposalEvent {
  date: string;
  type: "crypto-swap" | "crypto-spend" | "equity-sell" | "cashback";
  asset: string;
  proceeds: number;
  costBasis: number;
  gain: number;
}

function disposals(transactions: Transaction[]): DisposalEvent[] {
  const events: DisposalEvent[] = [];
  for (const t of transactions) {
    if (t.status === "declined") continue;
    // Crypto disposals: a swap or a card/transfer OUT denominated in a token.
    if (t.category === "swap" && t.token) {
      const cost = round(t.amountUsd * CRYPTO_BASIS_RATIO);
      events.push({
        date: t.timestamp,
        type: "crypto-swap",
        asset: t.token,
        proceeds: round(t.amountUsd),
        costBasis: cost,
        gain: round(t.amountUsd - cost),
      });
    } else if (t.direction === "out" && t.category === "card" && t.token) {
      const cost = round(t.amountUsd * CRYPTO_BASIS_RATIO);
      events.push({
        date: t.timestamp,
        type: "crypto-spend",
        asset: t.token,
        proceeds: round(t.amountUsd),
        costBasis: cost,
        gain: round(t.amountUsd - cost),
      });
    } else if (isCashback(t)) {
      // Cashback / rewards are ordinary income at receipt (basis = 0).
      events.push({
        date: t.timestamp,
        type: "cashback",
        asset: t.token ?? "USDC",
        proceeds: round(t.amountUsd),
        costBasis: 0,
        gain: round(t.amountUsd),
      });
    }
  }
  return events;
}

function isCashback(t: Transaction): boolean {
  return t.direction === "in" && /cashback|reward|rebate/i.test(`${t.title} ${t.subtitle}`);
}

export function buildPnl(account: UserAccount): PnlReport {
  const holdings = account.holdings;
  const transactions = account.transactions;

  const positions = holdings.map((h) => ({
    symbol: h.symbol,
    marketValue: round(h.marketValue),
    costBasis: round(h.costBasis ?? 0),
    unrealizedPnl: round(h.marketValue - (h.costBasis ?? 0)),
  }));
  const marketValue = round(positions.reduce((s, p) => s + p.marketValue, 0));
  const costBasis = round(positions.reduce((s, p) => s + p.costBasis, 0));

  const evs = disposals(transactions);
  const cryptoEvents = evs.filter((e) => e.type === "crypto-swap" || e.type === "crypto-spend");
  const cashbackEvents = evs.filter((e) => e.type === "cashback");

  const realizedPnl = round(cryptoEvents.reduce((s, e) => s + e.gain, 0));
  const proceeds = round(cryptoEvents.reduce((s, e) => s + e.proceeds, 0));
  const cashbackTotal = round(cashbackEvents.reduce((s, e) => s + e.gain, 0));

  return {
    generatedAt: new Date().toISOString(),
    equities: { marketValue, costBasis, unrealizedPnl: round(marketValue - costBasis), positions },
    crypto: { realizedPnl, disposalCount: cryptoEvents.length, proceeds },
    cashback: { total: cashbackTotal, count: cashbackEvents.length },
    totalPnl: round(marketValue - costBasis + realizedPnl + cashbackTotal),
  };
}

/** IRS Form-8949-style CSV of realized disposal events. */
//
// The account is REQUIRED. This used to accept `(year)` or nothing and fall back
// to the seeded demo account's transactions — a tax report of someone else's
// disposals for any caller that forgot to pass one.
export function buildTaxCsv(account: UserAccount, year?: number): string {
  const rows = disposals(account.transactions)
    .filter((e) => (year ? new Date(e.date).getUTCFullYear() === year : true))
    .sort((a, b) => a.date.localeCompare(b.date));

  const header = ["Date", "Type", "Asset", "Proceeds (USD)", "Cost Basis (USD)", "Gain/Loss (USD)"];
  const lines = rows.map((e) =>
    [
      e.date.slice(0, 10),
      e.type,
      e.asset,
      e.proceeds.toFixed(2),
      e.costBasis.toFixed(2),
      e.gain.toFixed(2),
    ].join(","),
  );
  const totalGain = rows.reduce((s, e) => s + e.gain, 0);
  lines.push(["", "", "TOTAL", "", "", totalGain.toFixed(2)].join(","));
  return [header.join(","), ...lines].join("\n");
}

