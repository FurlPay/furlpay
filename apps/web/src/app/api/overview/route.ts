import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { requireUser } from "@/lib/authz";
import { receiveAddressFor } from "@/lib/receiveAddress";

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
  const { id, name, kycStatus, region, tier } = account.user;
  // `safeAddress` is deliberately NOT projected. The dashboard fed it straight
  // into ScanToPay's receive QR, where a stranger would scan it and send money
  // to an address nobody holds a key for. The only address that may leave this
  // route is a verified one — see lib/receiveAddress.ts.
  const receive = receiveAddressFor(account);

  return NextResponse.json({
    user: {
      id,
      name,
      kycStatus,
      region,
      tier,
      receiveAddress: receive.ok ? receive.receive.address : null,
      receiveAddressUnavailableReason: receive.ok ? null : receive.reason,
    },
    netWorth,
    breakdown: { crypto, fiat, equities },
    tokenBalances: account.tokenBalances,
    fiatBalances: account.fiatBalances,
    recentTransactions: account.transactions.slice(0, 6),
  });
}
