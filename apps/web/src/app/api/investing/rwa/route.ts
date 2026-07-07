import { NextResponse } from "next/server";
import { db } from "@/lib/store";
import { getQuotes } from "@/lib/markets/quotes";

export const dynamic = "force-dynamic";

// GET /api/investing/rwa — tokenized real-world-asset (RWA) equity positions
// held on-chain (Robinhood Chain / Backed / Ondo style tokenized stocks) plus
// an AGGREGATE view that unifies them with the user's traditional (Alpaca)
// brokerage holdings. This is the "one dashboard for tokenized + traditional"
// angle: nobody else shows Alpaca stocks and on-chain stock tokens side by side.
//
// Demo: token positions are deterministic and priced off the same market quotes
// as the brokerage holdings, so a share of NVDA and a bNVDA token mark to the
// same price. A live build reads balances from the RWA token contracts.
const TOKENIZED = [
  { symbol: "NVDA", token: "bNVDA", shares: 1.5, chain: "robinhood", issuer: "Robinhood Chain" },
  { symbol: "AAPL", token: "bAAPL", shares: 3.0, chain: "robinhood", issuer: "Robinhood Chain" },
  { symbol: "GOOG", token: "bGOOG", shares: 0.8, chain: "arbitrum", issuer: "Backed Finance" },
];

export async function GET() {
  const quotes = await getQuotes().catch(() => null);
  const priceOf = (symbol: string, fallback: number) => quotes?.get(symbol)?.price ?? fallback;

  const seedPrice: Record<string, number> = { NVDA: 178.4, AAPL: 226.1, GOOG: 191.2 };

  const positions = TOKENIZED.map((p) => {
    const price = priceOf(p.symbol, seedPrice[p.symbol] ?? 100);
    return {
      ...p,
      price: round(price),
      marketValue: round(p.shares * price),
      custody: "self-custody" as const,
    };
  });
  const tokenizedValue = round(positions.reduce((s, p) => s + p.marketValue, 0));

  // Traditional brokerage side (Alpaca) from the store.
  const brokerageValue = round(db.holdings.reduce((s, h) => s + h.marketValue, 0));

  // Unified per-symbol view: brokerage shares + tokenized shares of the same name.
  const bySymbol = new Map<string, { symbol: string; brokerageShares: number; tokenizedShares: number; price: number }>();
  for (const h of db.holdings) {
    bySymbol.set(h.symbol, { symbol: h.symbol, brokerageShares: h.shares, tokenizedShares: 0, price: h.price });
  }
  for (const p of positions) {
    const e = bySymbol.get(p.symbol) ?? { symbol: p.symbol, brokerageShares: 0, tokenizedShares: 0, price: p.price };
    e.tokenizedShares += p.shares;
    e.price = p.price;
    bySymbol.set(p.symbol, e);
  }
  const unified = [...bySymbol.values()].map((e) => ({
    symbol: e.symbol,
    totalShares: round(e.brokerageShares + e.tokenizedShares),
    brokerageShares: round(e.brokerageShares),
    tokenizedShares: round(e.tokenizedShares),
    marketValue: round((e.brokerageShares + e.tokenizedShares) * e.price),
  }));

  return NextResponse.json({
    tokenized: positions,
    summary: {
      tokenizedValue,
      brokerageValue,
      totalEquityValue: round(tokenizedValue + brokerageValue),
    },
    unified: unified.sort((a, b) => b.marketValue - a.marketValue),
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
