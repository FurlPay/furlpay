import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { approvePayment, rejectPayment, listPaymentsForReview } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

// Human-in-the-loop compliance console for paused payments.
//   GET  /api/payments/review            → the officer's review queue
//   POST /api/payments/review            → { paymentId, decision: approve|reject, reason? }
//
// This route is NOT public (see middleware): a valid session is required, so
// the approve/reject decision is always attributable to a human officer — the
// boundary the analysis draws between what an agent may do (research/flag) and
// what a person must do (approve/file).

export async function GET() {
  return NextResponse.json({ queue: listPaymentsForReview() });
}

export async function POST(req: NextRequest) {
  const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const approver = claims?.sub;
  if (!approver) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
