import { NextRequest, NextResponse } from "next/server";
import { db, newTx, recordTransaction } from "@/lib/store";
import { selectVault, buildWithdrawBundle, earnIsLive } from "@/lib/services/morpho";
import { withdrawFromPosition } from "@/lib/services/earn";

export const dynamic = "force-dynamic";

// POST /api/earn/withdraw — withdraw USDC from a Morpho Earn position.
// Body: { amountUsd: number, vault?: address }.
//
// Non-custodial: LIVE mode returns the unsigned ERC-4626 withdraw calldata for
// the Safe to sign. MOCK mode simulates (reduce the position, credit idle USDC).
export async function POST(req: NextRequest) {
  const live = earnIsLive();
  if (process.env.NODE_ENV === "production" && !live) {
    return NextResponse.json({ ok: false, error: "earn_unavailable" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const amountUsd = Number(body?.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return NextResponse.json({ ok: false, error: "invalid_amount" }, { status: 400 });
  }

  const vault = await selectVault(typeof body?.vault === "string" ? body.vault : undefined);

  if (live) {
    const bundle = buildWithdrawBundle(vault.address, amountUsd, db.user.safeAddress);
    return NextResponse.json({
      ok: true,
      mode: "live",
      vault: { address: vault.address, name: vault.name },
      amountUsd: round(amountUsd),
      ...bundle,
    });
  }

  // MOCK: reduce the position and credit idle USDC.
  const result = withdrawFromPosition(vault.address, amountUsd);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  const bal = db.tokenBalances.find((b) => b.token === "USDC");
  if (bal) {
    bal.amount = round(bal.amount + result.withdrawnUsd);
    bal.usdValue = round(bal.usdValue + result.withdrawnUsd);
  } else {
    db.tokenBalances.push({ token: "USDC", chain: "arbitrum", amount: result.withdrawnUsd, usdValue: result.withdrawnUsd });
  }

  recordTransaction(
    newTx({
      category: "yield",
      direction: "in",
      title: "Withdrew from FurlPay Earn",
      subtitle: `${vault.name} · Arbitrum One`,
      amountUsd: result.withdrawnUsd,
      token: "USDC",
      chain: "arbitrum",
      status: "settled",
    }),
  );

  return NextResponse.json({
    ok: true,
    mode: "mock",
    withdrawnUsd: result.withdrawnUsd,
    remainingUsd: result.remainingUsd,
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
