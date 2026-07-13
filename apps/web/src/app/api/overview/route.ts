import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { requireUser } from "@/lib/authz";

// GET /api/overview — unified net worth across fiat + on-chain + equities.
// Scoped to the acting user: reads the caller's own account, never the shared
// demo store.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const crypto = account.tokenBalances.reduce((s, b) => s + b.usdValue, 0);
  const fiat = account.fiatBalances.reduce((s, b) => s + b.usdValue, 0);
  const equities = account.holdings.reduce((s, h) => s + h.marketValue, 0);
  const netWorth = crypto + fiat + equities;

  // Project only the fields the dashboard needs — never leak security/devices/notifications.
  const { id, name, safeAddress, kycStatus, region, tier } = account.user;

  return NextResponse.json({
    user: { id, name, safeAddress, kycStatus, region, tier },
    netWorth,
    breakdown: { crypto, fiat, equities },
    tokenBalances: account.tokenBalances,
    fiatBalances: account.fiatBalances,
    recentTransactions: account.transactions.slice(0, 6),
  });
}
