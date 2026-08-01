import { NextRequest, NextResponse } from "next/server";
import { getPayment } from "@/lib/services/payments";
import { getChain } from "@/lib/services/chainRegistry";

export const dynamic = "force-dynamic";

// GET /api/payments/:id/receipt — on-chain receipt for a settled payment:
// tx hash, explorer link, fee breakdown. 409 until the payment settles.
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const record = getPayment(params.id);
  if (!record) return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
  if (record.status !== "settled" && record.status !== "refunded") {
    return NextResponse.json(
      { error: "payment_not_settled", status: record.status },
      { status: 409 }
    );
  }

  const chain = getChain(record.settlementChain)!;
  return NextResponse.json({
    paymentId: record.id,
    status: record.status,
    transactionHash: record.transactionHash,
    explorerUrl: `${chain.explorer}/tx/${record.transactionHash}`,
    refundTransactionHash: record.refundTransactionHash ?? null,
    chain: chain.name,
    chainId: chain.chainId,
    payer: record.payer,
    recipient: record.recipient,
    amountUsdc: record.amountUsdc.toFixed(2),
    feeUsdc: record.feeUsdc.toFixed(2),
    settledAt: record.settledAt,
    metadata: record.metadata ?? {},
  });
}
