import { NextRequest, NextResponse } from "next/server";
import { captureHold, createHold, listHolds, releaseHold } from "@/lib/services/escrow";
import { db, newTx, recordTransaction } from "@/lib/store";

// GET /api/escrow — list all pre-auth holds.
export async function GET() {
  return NextResponse.json({ holds: listHolds() });
}

// POST /api/escrow — create / capture / release a hold.
// body: { action: "create"|"capture"|"release", ... }
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === "create") {
    const hold = createHold(body.cardId, body.merchant, body.amount);
    recordTransaction(
      newTx({
        category: "card",
        direction: "out",
        title: body.merchant,
        subtitle: "Pre-auth hold · escrow contract",
        amountUsd: body.amount,
        cardId: body.cardId,
        status: "escrow",
      })
    );
    return NextResponse.json({ hold });
  }

  if (body.action === "capture") {
    const hold = captureHold(body.id, body.finalAmount);
    const refund = hold.authorizedAmount - (hold.capturedAmount ?? 0);
    recordTransaction(
      newTx({
        category: "card",
        direction: "out",
        title: hold.merchant,
        subtitle: `Captured $${hold.capturedAmount?.toFixed(2)} · $${refund.toFixed(2)} returned to Safe`,
        amountUsd: hold.capturedAmount ?? 0,
        cardId: hold.cardId,
        status: "settled",
      })
    );
    return NextResponse.json({ hold, refundedToSafe: refund });
  }

  if (body.action === "release") {
    const hold = releaseHold(body.id);
    return NextResponse.json({ hold, refundedToSafe: hold.authorizedAmount });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
