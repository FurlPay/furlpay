import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { listTrips } from "@/lib/travel/store";

// POST /api/travel/rewards/claim — withdraw reward balance to a wallet.
// Body: { amountUsdc?, address? } — amount defaults to the full balance.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const balance =
    Math.round(
      listTrips()
        .filter((t) => t.status === "confirmed")
        .reduce((s, t) => s + t.cashbackUsd, 0) * 100,
    ) / 100;

  const amount = body.amountUsdc ? Number(body.amountUsdc) : balance;
  if (!amount || amount <= 0) {
    return NextResponse.json({ error: "Nothing to claim." }, { status: 400 });
  }
  if (amount > balance) {
    return NextResponse.json({ error: `Amount exceeds claimable balance of ${balance} USDC.` }, { status: 400 });
  }

  return NextResponse.json({
    claim: {
      id: "clm_" + Math.random().toString(36).slice(2, 10),
      amountUsdc: amount,
      to: body.address ?? "FurlPay wallet",
      network: "base",
      txHash: "0x" + Math.random().toString(16).slice(2).padEnd(40, "0").slice(0, 40),
      status: "settled",
      simulated: true,
    },
  });
}
