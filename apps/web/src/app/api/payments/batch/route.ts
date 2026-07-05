import { NextRequest, NextResponse } from "next/server";
import { PaymentBatchSchema, parse } from "@/lib/schemas";
import { createPayment } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

// POST /api/payments/batch — create up to 100 payment intents in one call
// (payroll, supplier payouts). Each returns its own EIP-712 sign data; a
// LIVE deployment settles them as one FurlPayRouter.batchPay() transaction
// (~45% cheaper than sequential transfers).
export async function POST(req: NextRequest) {
  const parsed = parse(PaymentBatchSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const sourceChain = parsed.data.sourceChain ?? "arbitrum";

  const created = await Promise.all(
    parsed.data.payments.map((p) =>
      createPayment({ amount: p.amount, sourceChain, recipient: p.recipient, metadata: p.metadata })
    )
  );

  const totalAmount = created.reduce((s, c) => s + c.record.amountUsdc, 0);
  const totalFees = created.reduce((s, c) => s + c.record.feeUsdc, 0);

  return NextResponse.json(
    {
      batchSize: created.length,
      totalAmountUsdc: totalAmount.toFixed(2),
      totalFeesUsdc: totalFees.toFixed(2),
      payments: created.map((c) => ({
        paymentId: c.record.id,
        recipient: c.record.recipient,
        amountUsdc: c.record.amountUsdc.toFixed(2),
        feeUsdc: c.record.feeUsdc.toFixed(2),
        expiresAt: c.record.expiresAt,
        signData: c.signData,
      })),
    },
    { status: 201 }
  );
}
