import { NextRequest, NextResponse } from "next/server";
import { getAccountBalanceUsd } from "@/lib/services/account";
import { requireUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

// GET /api/account/balance — the SESSION user's spendable FurlPay account
// balance (USDC on Arbitrum One).
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  return NextResponse.json({
    token: "USDC",
    chain: "arbitrum",
    balanceUsd: getAccountBalanceUsd(auth.account.user.id).toFixed(2),
  });
}
