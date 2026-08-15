import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getSettlement, recordSettlement } from "@/lib/x402SettlementStore";
import { checkSettlementOnChain } from "@/lib/x402Settler";
import { requiredConfirmations } from "@/lib/x402";

export const dynamic = "force-dynamic";

// GET /api/x402/settlement/:tx — settlement status for an x402 payment.
// Agents poll this after a settle to confirm the on-chain leg — including the
// recovery case where the settle call timed out AFTER the transaction was
// submitted (client saw 402 + `pending`): a "pending" record is re-checked
// against the chain here and upgraded to "confirmed" once the required
// confirmation depth is observed.
export async function GET(req: NextRequest, props: { params: Promise<{ tx: string }> }) {
  const limited = await rateLimitOr429(req, "x402.settlement.tx", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const params = await props.params;
  const settlement = await getSettlement(params.tx);
  if (!settlement) {
    return NextResponse.json({ settled: false, error: "settlement_not_found" }, { status: 404 });
  }

  if (settlement.status === "pending") {
    const onChain = await checkSettlementOnChain(settlement.transaction, settlement.network);
    if (onChain?.confirmed && onChain.confirmations >= requiredConfirmations(settlement.amountAtomic)) {
      const confirmed = { ...settlement, status: "confirmed" as const };
      await recordSettlement(confirmed);
      return NextResponse.json({ settled: true, settlement: confirmed });
    }
    // Still pending (or RPC unavailable): report honestly; the client keeps
    // polling instead of re-signing a duplicate payment.
    return NextResponse.json(
      { settled: false, pending: true, settlement, confirmations: onChain?.confirmations ?? 0 },
      { status: 202 }
    );
  }

  return NextResponse.json({ settled: true, settlement });
}
