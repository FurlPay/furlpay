import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { requireUser } from "@/lib/authz";

// The paymaster is not deployed (see below), so there is no paymaster
// configuration to read: the fee token is the one the module is designed for.
const PAYMASTER_FEE_TOKEN = "USDC";

// GET /api/wallets — the user's account view, scoped to the AUTHENTICATED user.
//
// WHAT THIS IS NOT, stated because the response used to imply otherwise. This
// route reported four on-chain "modules" with `enabled: true` against an address
// that is NOT a deployed Safe: `user.safeAddress` is
// `"0x" + sha256("furlpay:safe:" + key).slice(0, 40)` (lib/store.ts), a
// deterministic placeholder nobody holds keys to. A client reading the old
// response would conclude a Safe4337Module was live on chain. None of it was.
//
// The response now says what each thing actually is: `accountType` marks the
// address as a ledger placeholder, and every capability carries where it is
// enforced — `off-chain` policy that genuinely runs on our side, versus
// `not-deployed` for the on-chain pieces that do not exist yet.
// See docs/BALANCE-CUSTODY-MAP.md and docs/CUSTODY-DISCLOSURE.md.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;


  return NextResponse.json({
    safeAddress: account.user.safeAddress,
    // The field name is kept for API compatibility; this says what it holds.
    accountType: "ledger_placeholder",
    accountNote:
      "Not a deployed Safe. This is a deterministic identifier for an internal " +
      "ledger account; no key exists for it and no contract is deployed at it. " +
      "Do not send funds to this address.",
    modules: [
      // Enforced by our server today — these are real, and off-chain.
      { name: "PolicyGuard", type: "off-chain-cosigner", enforcement: "off-chain", enabled: true },
      // Not deployed. Reported so the intended shape is visible, never as live.
      { name: "Escrow", type: "pre-auth-hold", enforcement: "not-deployed", enabled: false },
      {
        name: "Paymaster",
        type: "gas-sponsorship",
        enforcement: "not-deployed",
        enabled: false,
        feeToken: PAYMASTER_FEE_TOKEN,
      },
      { name: "Safe4337Module", type: "erc-4337", enforcement: "not-deployed", enabled: false },
    ],
    balances: account.tokenBalances.map((b) => ({
      token: b.token,
      amount: b.amount.toFixed(2),
      chain: b.chain,
      usdValue: b.usdValue,
    })),
  });
}
