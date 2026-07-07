import { NextRequest, NextResponse } from "next/server";
import { db, newTx, recordTransaction } from "@/lib/store";

export const dynamic = "force-dynamic";

// POST /api/earn/deposit — move idle stablecoin into a FurlPay Earn position.
// Body: { token: "USDC" | "USDT" | "EURC", amountUsd: number }. Demo: the
// deposit debits the on-hand token balance and opens/extends a position in an
// in-memory Earn book. A live build routes to the Aave/Morpho vault adapter and
// records the position in the ledger. INTEGRATION_MODE=live is required before
// real funds move — mirrors the account-funding guard.
const APY: Record<string, number> = { USDC: 8.2, USDT: 9.5, EURC: 6.4 };

interface EarnPosition {
  token: string;
  principal: number;
  apy: number;
  openedAt: string;
}
const g = globalThis as unknown as { __earn?: EarnPosition[] };
const positions = g.__earn ?? (g.__earn = []);

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production" && process.env.INTEGRATION_MODE !== "live") {
    return NextResponse.json({ ok: false, error: "earn_unavailable" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const token = String(body?.token ?? "USDC").toUpperCase();
  const amountUsd = Number(body?.amountUsd);

  if (!APY[token]) {
    return NextResponse.json({ ok: false, error: "unsupported_token" }, { status: 400 });
  }
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return NextResponse.json({ ok: false, error: "invalid_amount" }, { status: 400 });
  }

  const bal = db.tokenBalances.find((b) => b.token === token);
  if (!bal || bal.usdValue + 1e-9 < amountUsd) {
    return NextResponse.json({ ok: false, error: "insufficient_balance" }, { status: 400 });
  }

  // Debit the on-hand balance.
  const perUnit = bal.amount > 0 ? bal.usdValue / bal.amount : 1;
  bal.amount = round(bal.amount - amountUsd / perUnit);
  bal.usdValue = round(bal.usdValue - amountUsd);

  const apy = APY[token];
  let pos = positions.find((p) => p.token === token);
  if (pos) pos.principal = round(pos.principal + amountUsd);
  else {
    pos = { token, principal: round(amountUsd), apy, openedAt: new Date().toISOString() };
    positions.push(pos);
  }

  recordTransaction(
    newTx({
      category: "yield",
      direction: "out",
      title: `Deposited into FurlPay Earn`,
      subtitle: `${token} · ${apy}% APY`,
      amountUsd,
      token: token as never,
      status: "settled",
    }),
  );

  return NextResponse.json({
    ok: true,
    position: pos,
    projectedYearly: round((pos.principal * apy) / 100),
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
