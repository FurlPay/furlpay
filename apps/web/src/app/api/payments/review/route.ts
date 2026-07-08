import { NextRequest, NextResponse } from "next/server";
import { approvePayment, rejectPayment, listPaymentsForReview } from "@/lib/services/payments";
import { requireRole } from "@/lib/authz";

export const dynamic = "force-dynamic";

// Human-in-the-loop compliance console for paused payments.
//   GET  /api/payments/review            → the officer's review queue
//   POST /api/payments/review            → { paymentId, decision: approve|reject, reason? }
//
// Both verbs require the compliance_officer ROLE — a valid session alone is
// not enough. The queue exposes payer/recipient/amount data, and the decision
// must be attributable to a human officer (the service additionally refuses
// an officer approving their own payment — separation of duties).

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, "compliance_officer");
  if (!auth.ok) return auth.res;

  return NextResponse.json({ queue: listPaymentsForReview() });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, "compliance_officer");
  if (!auth.ok) return auth.res;
  const approver = auth.account.user.id;

  const body = await req.json().catch(() => ({}));
  const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
  const decision = body.decision === "reject" ? "reject" : body.decision === "approve" ? "approve" : "";
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : undefined;

  if (!paymentId || !decision) {
    return NextResponse.json(
      { error: "paymentId and decision ('approve' | 'reject') are required." },
      { status: 400 }
    );
  }

  const result =
    decision === "approve" ? approvePayment(paymentId, approver) : rejectPayment(paymentId, approver, reason);

  if (!result.ok) {
    return NextResponse.json({ error: result.error, payment: result.record ?? null }, { status: result.status });
  }
  const r = result.record!;
  return NextResponse.json({
    paymentId: r.id,
    status: r.status,
    decision,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt,
    transactionHash: r.transactionHash,
    blockedReason: r.blockedReason,
  });
}
