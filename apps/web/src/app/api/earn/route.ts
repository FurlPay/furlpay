import { NextResponse } from "next/server";
import { db } from "@/lib/store";

export const dynamic = "force-dynamic";

// GET /api/earn — stablecoin yield products and the user's active positions.
// Mock/demo: APYs and positions are deterministic. A live build sources rates
// from the vault adapters and positions from the ledger.
const PRODUCTS = [
  { token: "USDC", apy: 8.2, risk: "Low", protocol: "Furlpay Earn · Aave v3", min: 10 },
  { token: "USDT", apy: 9.5, risk: "Low", protocol: "Furlpay Earn · Morpho", min: 10 },
  { token: "EURC", apy: 6.4, risk: "Low", protocol: "Furlpay Earn · Aave v3", min: 10 },
  { token: "ETH", apy: 3.1, risk: "Medium", protocol: "Lido stETH", min: 0.01 },
];

// Deterministic demo positions the user already holds.
const POSITIONS = [
  { token: "USDC", principal: 2500, apy: 8.2, earnedUsd: 41.09, days: 73 },
  { token: "USDT", principal: 640.12, apy: 9.5, earnedUsd: 12.18, days: 51 },
];

export async function GET() {
  const totalPrincipal = POSITIONS.reduce((s, p) => s + p.principal, 0);
  const totalEarned = POSITIONS.reduce((s, p) => s + p.earnedUsd, 0);
  const blendedApy =
    totalPrincipal > 0
      ? POSITIONS.reduce((s, p) => s + p.apy * p.principal, 0) / totalPrincipal
      : 0;
  // Projected next-year yield at the blended rate.
  const projectedYearly = (totalPrincipal * blendedApy) / 100;

  return NextResponse.json({
    products: PRODUCTS,
    positions: POSITIONS,
    summary: {
      totalPrincipal,
      totalEarned,
      blendedApy: Number(blendedApy.toFixed(2)),
      projectedYearly: Number(projectedYearly.toFixed(2)),
    },
    idleUsdc:
      db.tokenBalances.find((b) => b.token === "USDC")?.usdValue ?? 0,
  });
}
