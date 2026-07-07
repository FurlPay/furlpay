import { NextRequest, NextResponse } from "next/server";
import { PaymentCreateSchema, parse } from "@/lib/schemas";
import { createPayment } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

// POST /api/payments/create — create a USDC payment intent. Returns the
// quote (0.5% fee + gas estimate) and the EIP-712 typed data the payer's
// wallet signs. Settlement is always Arbitrum One.
export async function POST(req: NextRequest) {
  const parsed = parse(PaymentCreateSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  // Idempotency-Key (RFC-style header): a retry with the same key returns the
  // same intent instead of minting a duplicate — the retry-storm guard.
  const idempotencyKey = req.headers.get("Idempotency-Key")?.slice(0, 200) || undefined;

  const { record, replayed, gasEstimateUsd, contract, chainId, signData } = await createPayment({
    amount: body.amount,
    sourceChain: body.sourceChain ?? "arbitrum",
    recipient: body.recipient,
    metadata: body.metadata,
    idempotencyKey,
  });

  return NextResponse.json(
    {
      paymentId: record.id,
      status: record.status,
      replayed,
      amountUsdc: record.amountUsdc.toFixed(2),
      feeUsdc: record.feeUsdc.toFixed(2),
      gasEstimateUsd,
      contract,
      chainId,
      expiresAt: record.expiresAt,
      signData,
    },
    // 200 on an idempotent replay, 201 when a new intent was created.
    { status: replayed ? 200 : 201 }
  );
}
