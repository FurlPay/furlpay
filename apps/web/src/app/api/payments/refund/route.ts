import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/validate";
import { z } from "zod";
import { parse } from "@/lib/schemas";
import { refundPayment } from "@/lib/services/payments";
import { requireRole } from "@/lib/authz";

export const dynamic = "force-dynamic";

const RefundSchema = z.object({ paymentId: z.string().startsWith("pay_") });

// POST /api/payments/refund — reverse a settled payment (full refund).
// Privileged: refunds move money back out, so only a compliance officer may
// trigger one. Only settled payments are refundable; the reversal gets its
// own tx hash and a compensating ledger entry.
export async function POST(req: NextRequest) {
  const auth = await requireRole(req, "compliance_officer");
  if (!auth.ok) return auth.res;

  const parsed = parse(RefundSchema, await readJsonBody(req).catch(() => ({})));
  if (!parsed.ok) return parsed.res;

  const result = await refundPayment(parsed.data.paymentId, auth.account.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const r = result.record!;
  return NextResponse.json({
    paymentId: r.id,
    status: r.status,
    refundTransactionHash: r.refundTransactionHash,
    refundedAt: r.refundedAt,
  });
}
