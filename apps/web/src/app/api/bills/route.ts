import { NextRequest, NextResponse } from "next/server";
import { newTx, recordTransaction } from "@/lib/store";
import { requireUser } from "@/lib/authz";

// GET /api/bills — the SESSION user's connected bills.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  return NextResponse.json({ bills: auth.account.bills });
}

// POST /api/bills — pay a bill on-chain, or toggle autopay.
// body: { id, action: "pay"|"toggleAutopay" }
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const { id, action } = await req.json();
  const bill = auth.account.bills.find((b) => b.id === id);
  if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });

  if (action === "toggleAutopay") {
    bill.autopay = !bill.autopay;
    return NextResponse.json({ bill });
  }

  if (action === "pay") {
    const paid = bill.balanceDue;
    recordTransaction(
      auth.account.user.id,
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
