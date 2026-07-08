import { NextRequest, NextResponse } from "next/server";
import { PaymentExecuteSchema, parse } from "@/lib/schemas";
import { executePayment } from "@/lib/services/payments";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// POST /api/payments/execute — submit the payer's EIP-712 signature and
// settle on Arbitrum One. Both payer and recipient are OFAC-screened before
// the transfer; a sanctions hit blocks the payment permanently.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = rateLimitOr429(req, "payments.execute", { limit: 60, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const parsed = parse(PaymentExecuteSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const { paymentId, payer, signature } = parsed.data;

  const result = executePayment(paymentId, payer, signature, auth.account.user.id);

  // Paused for human compliance review (HITL): 202 Accepted, not an error —
  // the client should poll GET /api/payments/:id until it settles or blocks.
  if (result.pending && result.record) {
    const r = result.record;
    return NextResponse.json(
      { paymentId: r.id, status: r.status, reviewReason: r.reviewReason, pending: true },
      { status: 202 }
    );
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, payment: result.record ?? null },
      { status: result.status }
    );
  }
  const r = result.record!;
  return NextResponse.json({
    paymentId: r.id,
    status: r.status,
    replayed: result.replayed ?? false,
    transactionHash: r.transactionHash,
    settlementChain: r.settlementChain,
    settledAt: r.settledAt,
  });
}
