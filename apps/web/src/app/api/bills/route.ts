import { NextRequest, NextResponse } from "next/server";
import { db, newTx, recordTransaction } from "@/lib/store";

// GET /api/bills — connected bills.
export async function GET() {
  return NextResponse.json({ bills: db.bills });
}

// POST /api/bills — pay a bill on-chain, or toggle autopay.
// body: { id, action: "pay"|"toggleAutopay" }
export async function POST(req: NextRequest) {
  const { id, action } = await req.json();
  const bill = db.bills.find((b) => b.id === id);
  if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });

  if (action === "toggleAutopay") {
    bill.autopay = !bill.autopay;
    return NextResponse.json({ bill });
  }

  if (action === "pay") {
    const paid = bill.balanceDue;
    recordTransaction(
      newTx({
        category: "bill",
        direction: "out",
        title: bill.provider,
        subtitle: "On-chain bill pay · USDC",
        amountUsd: paid,
        token: "USDC",
        status: "settled",
      })
    );
    bill.balanceDue = 0;
    return NextResponse.json({ bill, paid });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
