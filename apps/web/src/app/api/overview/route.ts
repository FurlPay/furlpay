import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { db } from "@/lib/store";

// GET /api/overview — unified net worth across fiat + on-chain + equities.
export async function GET() {
  const crypto = db.tokenBalances.reduce((s, b) => s + b.usdValue, 0);
  const fiat = db.fiatBalances.reduce((s, b) => s + b.usdValue, 0);
  const equities = db.holdings.reduce((s, h) => s + h.marketValue, 0);
  const netWorth = crypto + fiat + equities;

  // Project only the fields the dashboard needs — never leak security/devices/notifications.
  const { id, name, safeAddress, kycStatus, region, tier } = db.user;

  return NextResponse.json({
    user: { id, name, safeAddress, kycStatus, region, tier },
    netWorth,
    breakdown: { crypto, fiat, equities },
    tokenBalances: db.tokenBalances,
    fiatBalances: db.fiatBalances,
    recentTransactions: db.transactions.slice(0, 6),
  });
}
