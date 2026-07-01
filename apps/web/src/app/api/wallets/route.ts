import { NextResponse } from "next/server";
import { AccountKit } from "@furlpay/account-kit";
import { db } from "@/lib/store";

const accountKit = new AccountKit({ chain: "base", mock: true });

// GET /api/wallets — Safe smart account: balances + active on-chain modules.
export async function GET() {
  // Paymaster config surfaced via the Account Kit (gas sponsorship in USDC).
  const { config } = await accountKit.configurePaymaster(db.user.safeAddress, {
    mode: "erc20",
    feeToken: "USDC",
  });

  return NextResponse.json({
    safeAddress: db.user.safeAddress,
    modules: [
      { name: "PolicyGuard", type: "off-chain-cosigner", enabled: true },
      { name: "Escrow", type: "pre-auth-hold", enabled: true },
      { name: "Paymaster", type: "gas-sponsorship", enabled: true, feeToken: config.feeToken },
      { name: "Safe4337Module", type: "erc-4337", enabled: true },
    ],
    balances: db.tokenBalances.map((b) => ({
      token: b.token,
      amount: b.amount.toFixed(2),
      chain: b.chain,
      usdValue: b.usdValue,
    })),
  });
}
