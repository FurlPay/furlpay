import { NextRequest, NextResponse } from "next/server";
import { screenTransaction, type TxRequest } from "@furlpay/security";

export const dynamic = "force-dynamic";

// POST /api/security/simulate — pre-sign transaction screening. Simulates the
// effect of an outgoing transfer/approval and runs the ML scam classifier,
// returning an allow/warn/block gate the client enforces BEFORE signing.
// Body: TxRequest ({ from, to, valueUsd, approvalAmount?, recipientAgeDays?, ... }).
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as Partial<TxRequest>;
  if (!b?.to || typeof b.to !== "string") {
    return NextResponse.json({ error: "recipient `to` is required" }, { status: 400 });
  }
  const tx: TxRequest = {
    from: String(b.from ?? ""),
    to: b.to,
    valueUsd: Number(b.valueUsd ?? 0),
    approvalAmount: b.approvalAmount,
    token: b.token,
    recipientAgeDays: b.recipientAgeDays,
    lookalikeOfKnown: b.lookalikeOfKnown,
    flaggedRecipient: b.flaggedRecipient,
    firstInteraction: b.firstInteraction,
    knownGoodContract: b.knownGoodContract,
  };
  return NextResponse.json(screenTransaction(tx));
}
