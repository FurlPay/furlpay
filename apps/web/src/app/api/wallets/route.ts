import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { AccountKit } from "@furlpay/account-kit";
import { requireUser } from "@/lib/authz";

const accountKit = new AccountKit({ chain: "base", mock: true });

// GET /api/wallets — Safe smart account: balances + active on-chain modules,
// scoped to the AUTHENTICATED user. Previously it returned the seeded demo
// account's safeAddress and balances to any caller.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  // Paymaster config surfaced via the Account Kit (gas sponsorship in USDC).
  const { config } = await accountKit.configurePaymaster(account.user.safeAddress, {
    mode: "erc20",
    feeToken: "USDC",
  });

  return NextResponse.json({
    safeAddress: account.user.safeAddress,
    modules: [
      { name: "PolicyGuard", type: "off-chain-cosigner", enabled: true },
      { name: "Escrow", type: "pre-auth-hold", enabled: true },
      { name: "Paymaster", type: "gas-sponsorship", enabled: true, feeToken: config.feeToken },
      { name: "Safe4337Module", type: "erc-4337", enabled: true },
    ],
    balances: account.tokenBalances.map((b) => ({
      token: b.token,
      amount: b.amount.toFixed(2),
      chain: b.chain,
      usdValue: b.usdValue,
    })),
  });
}
