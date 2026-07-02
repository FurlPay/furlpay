import { NextResponse } from "next/server";
import { db } from "@/lib/store";

export const dynamic = "force-dynamic";

// GET /api/credit — portfolio-backed credit line. Borrowing power is derived
// from the user's on-chain balances AND their equity holdings (the combination
// no card-only competitor can offer), each discounted by an asset-class LTV.
// Interest accrues only on drawn funds; borrowing is not a taxable event.
//
// Mock/demo: `drawn` is a fixed demo balance. A live build books draws/repays
// through the ledger and liquidates via the policy engine at max LTV.

const STABLES = new Set(["USDC", "USDT", "EURC", "PYUSD", "DAI"]);
const APR = 7.9;
const MAX_LTV = 0.7; // portfolio-wide liquidation threshold

function cryptoLtv(token: string): number {
  if (STABLES.has(token)) return 0.9;
  if (token === "BTC") return 0.6;
  if (token === "ETH") return 0.55;
  if (token === "SOL") return 0.45;
  return 0.5;
}

export async function GET() {
  const collateral: { label: string; kind: "stablecoin" | "crypto" | "equity"; value: number; ltv: number; borrowable: number }[] = [];

  for (const b of db.tokenBalances) {
    const ltv = cryptoLtv(b.token);
    collateral.push({
      label: `${b.token} · ${b.chain}`,
      kind: STABLES.has(b.token) ? "stablecoin" : "crypto",
      value: b.usdValue,
      ltv,
      borrowable: Math.round(b.usdValue * ltv * 100) / 100,
    });
  }
  // Equities pooled as one line (fractional stocks/ETFs via Alpaca).
  const equityValue = db.holdings.reduce((s, h) => s + h.marketValue, 0);
  if (equityValue > 0) {
    collateral.push({
      label: "Stocks & ETFs",
      kind: "equity",
      value: Math.round(equityValue * 100) / 100,
      ltv: 0.6,
      borrowable: Math.round(equityValue * 0.6 * 100) / 100,
    });
  }

  const totalCollateral = collateral.reduce((s, c) => s + c.value, 0);
  const borrowingPower = collateral.reduce((s, c) => s + c.borrowable, 0);
  const drawn = 1200; // demo outstanding balance
  const available = Math.max(0, borrowingPower - drawn);
  const utilizationPct = borrowingPower > 0 ? Math.round((drawn / borrowingPower) * 100) : 0;
  const currentLtv = totalCollateral > 0 ? drawn / totalCollateral : 0;
  // Health = headroom to the liquidation LTV; >1.5 is comfortable.
  const healthFactor = drawn > 0 ? Number(((MAX_LTV * totalCollateral) / drawn).toFixed(2)) : null;
  const monthlyInterest = Math.round(((drawn * APR) / 100 / 12) * 100) / 100;

  return NextResponse.json({
    apr: APR,
    totalCollateral: Math.round(totalCollateral * 100) / 100,
    borrowingPower: Math.round(borrowingPower * 100) / 100,
    drawn,
    available: Math.round(available * 100) / 100,
    utilizationPct,
    currentLtvPct: Math.round(currentLtv * 100),
    maxLtvPct: Math.round(MAX_LTV * 100),
    healthFactor,
    monthlyInterest,
    collateral: collateral.sort((a, b) => b.value - a.value),
  });
}
