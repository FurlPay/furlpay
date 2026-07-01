import { NextRequest, NextResponse } from "next/server";
import { constructEvent } from "@furlpay/compliance";
import { db, newTx, recordTransaction } from "@/lib/store";
import { markProcessed } from "@/lib/webhookGuard";

// POST /api/webhooks/wise — incoming bank transfer notifications (Wise / BaaS).
export async function POST(req: NextRequest) {
  const body = await req.text();
  const secret = process.env.FURLPAY_ENDPOINT_SECRET || "whsec_sandbox_wise";

  let event;
  try {
    event = constructEvent<any>(body, req.headers.get("furlpay-signature"), secret);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  if (!markProcessed(event.id)) {
    return NextResponse.json({ received: true, deduped: true });
  }

  if (event.type === "transfer.credited") {
    const { currency, amount, usdValue } = event.data;
    const acct = db.fiatBalances.find((f) => f.currency === currency);
    if (acct) acct.amount += amount;
    recordTransaction(
      newTx({
        category: "ramp",
        direction: "in",
        title: `Bank deposit ${currency}`,
        subtitle: "Wise · incoming transfer",
        amountUsd: usdValue ?? amount,
        status: "settled",
      })
    );
  }

  return NextResponse.json({ received: true, type: event.type });
}
