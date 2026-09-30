import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { capabilityMode, capabilityUnavailable } from "@/lib/capabilityGate";

export const dynamic = "force-dynamic";

// GET /api/credit — portfolio-backed credit line. Borrowing power is derived
// from the user's on-chain balances AND their equity holdings (the combination
// no card-only competitor can offer), each discounted by an asset-class LTV.
// Interest accrues only on drawn funds; borrowing is not a taxable event.
//
// NOT LIVE. No lender, no draw/repay ledger and no liquidation engine exist
// (CREDIT_LIVE carries an `unimplemented` reason in lib/flags.ts). This route
// used to report `drawn: 1200` to EVERY user in production — an outstanding
// debt nobody incurred, which for a user with no collateral rendered as
// "$1,200 drawn, $0 available, health 0". Production now answers 503; outside
// production the fixture is served and marked `simulated: true`.

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

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const mode = capabilityMode("CREDIT_LIVE");
  if (mode === null) return capabilityUnavailable("CREDIT_LIVE", "Credit");
  const account = auth.account;

  const collateral: { label: string; kind: "stablecoin" | "crypto" | "equity"; value: number; ltv: number; borrowable: number }[] = [];

  for (const b of account.tokenBalances) {
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
  const equityValue = account.holdings.reduce((s, h) => s + h.marketValue, 0);
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
  // Simulation fixture only: there is no credit ledger to read a real drawn
  // balance from, and CREDIT_LIVE cannot turn on until there is.
  const drawn = 1200;
  const available = Math.max(0, borrowingPower - drawn);
  const utilizationPct = borrowingPower > 0 ? Math.round((drawn / borrowingPower) * 100) : 0;
  const currentLtv = totalCollateral > 0 ? drawn / totalCollateral : 0;
  // Health = headroom to the liquidation LTV; >1.5 is comfortable.
  const healthFactor = drawn > 0 ? Number(((MAX_LTV * totalCollateral) / drawn).toFixed(2)) : null;
  const monthlyInterest = Math.round(((drawn * APR) / 100 / 12) * 100) / 100;

  return NextResponse.json({
    simulated: mode === "simulated",
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
