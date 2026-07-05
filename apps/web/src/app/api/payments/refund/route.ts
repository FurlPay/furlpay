import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parse } from "@/lib/schemas";
import { refundPayment } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

const RefundSchema = z.object({ paymentId: z.string().startsWith("pay_") });

// POST /api/payments/refund — reverse a settled payment (full refund).
// Only settled payments are refundable; the reversal gets its own tx hash.
export async function POST(req: NextRequest) {
  const parsed = parse(RefundSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;

  const result = refundPayment(parsed.data.paymentId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const r = result.record!;
  return NextResponse.json({
    paymentId: r.id,
    status: r.status,
    refundTransactionHash: r.refundTransactionHash,
    refundedAt: r.refundedAt,
  });
}
