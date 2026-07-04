import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { MCC } from "@/lib/travel/data";

// POST /api/travel/cards/create — generate a single-use travel VCN funded
// from the user's stablecoin balance, MCC-locked to travel merchants.
// Body: { limitUsd, mcc?: string[] }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const limitUsd = Number(body.limitUsd);
  if (!limitUsd || limitUsd <= 0) {
    return NextResponse.json({ error: "limitUsd must be > 0" }, { status: 400 });
  }
  if (limitUsd > 25_000) {
    return NextResponse.json({ error: "Single-use travel cards are capped at $25,000." }, { status: 400 });
  }

  const mcc: string[] = Array.isArray(body.mcc) && body.mcc.length ? body.mcc.map(String) : [MCC.LODGING, MCC.AIRLINES];
  const last4 = String(1000 + Math.floor(Math.random() * 9000)).slice(-4);
  const expiry = new Date(Date.now() + 30 * 86_400_000);

  return NextResponse.json({
    card: {
      id: "vcn_" + Math.random().toString(36).slice(2, 10),
      network: "Visa",
      maskedNumber: `4••• •••• •••• ${last4}`,
      last4,
      expires: `${String(expiry.getMonth() + 1).padStart(2, "0")}/${String(expiry.getFullYear()).slice(2)}`,
      limitUsd,
      singleUse: true,
      mccLocks: mcc,
      fundedFrom: "USDC balance",
      status: "active",
      simulated: true,
    },
  });
}
