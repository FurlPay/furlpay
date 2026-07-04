import { NextRequest, NextResponse } from "next/server";
import { captureHold, createHold, listHolds, releaseHold } from "@/lib/services/escrow";
import { db, newTx, recordTransaction } from "@/lib/store";
import { verifyAgentSignature } from "@/lib/agentTrustGate";

// GET /api/escrow — list all pre-auth holds.
export async function GET() {
  return NextResponse.json({ holds: listHolds() });
}

// POST /api/escrow — create / capture / release a hold.
// body: { action: "create"|"capture"|"release", ... }
// Agent-initiated calls sign with RFC 9421 headers (@furlpay/agent-trust
// signRequest, key registered via /api/agents/keys); a present-but-invalid
// signature or tampered body is rejected before any hold mutation.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  let agentKeyId: string | null;
  try {
    agentKeyId = verifyAgentSignature(req, raw);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
  let body: any;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (body.action === "create") {
    const hold = createHold(body.cardId, body.merchant, body.amount);
    recordTransaction(
      newTx({
        category: "card",
        direction: "out",
        title: body.merchant,
        subtitle: agentKeyId ? `Pre-auth hold · escrow contract · agent ${agentKeyId}` : "Pre-auth hold · escrow contract",
        amountUsd: body.amount,
        cardId: body.cardId,
        status: "escrow",
      })
    );
    return NextResponse.json({ hold, agentKeyId });
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
