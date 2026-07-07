import { NextResponse } from "next/server";
import { getAccountBalanceUsd } from "@/lib/services/account";

export const dynamic = "force-dynamic";

// GET /api/account/balance — the spendable FurlPay account balance (USDC on
// Arbitrum One). Session-gated by middleware.
export function GET() {
  return NextResponse.json({
    token: "USDC",
    chain: "arbitrum",
    balanceUsd: getAccountBalanceUsd().toFixed(2),
  });
}
