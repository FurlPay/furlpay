import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import {
  getSettlement,
  pendingExpired,
  recordSettlement,
  PENDING_TIMEOUT_MS,
} from "@/lib/x402SettlementStore";
import { log } from "@/lib/log";
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
    if (!settlement.expectedTransfer) {
      const abandoned = {
        ...settlement,
        status: "abandoned" as const,
        abandonedReason: "legacy settlement record lacks the expected transfer needed for receipt verification",
      };
      await recordSettlement(abandoned);
      return NextResponse.json({ settled: false, pending: false, abandoned: true, settlement: abandoned }, { status: 409 });
    }

    const onChain = await checkSettlementOnChain(settlement.transaction, settlement.network, settlement.expectedTransfer);
    if (onChain?.confirmed && onChain.receiptVerified !== false && onChain.confirmations >= requiredConfirmations(settlement.amountAtomic)) {
      const confirmed = { ...settlement, status: "confirmed" as const };
      await recordSettlement(confirmed);
      return NextResponse.json({ settled: true, settlement: confirmed });
    }

    if (onChain?.found && onChain.confirmed && onChain.receiptVerified === false) {
      const abandoned = {
        ...settlement,
        status: "abandoned" as const,
        abandonedReason: "on-chain receipt does not match the authorized transfer",
      };
      await recordSettlement(abandoned);
      log.error("x402 settlement receipt mismatch during recovery", {
        tx: abandoned.transaction,
        network: abandoned.network,
      });
      return NextResponse.json({ settled: false, pending: false, abandoned: true, settlement: abandoned }, { status: 409 });
    }

    // A PENDING SETTLEMENT NEEDS AN END STATE.
    //
    // Previously this branch had exactly two outcomes: confirmed, or keep
    // polling. There was no third, so a transaction that was dropped from the
    // mempool or replaced by a fee bump stayed "pending" forever — the client
    // polled indefinitely, nothing was paged, and the payer may already have
    // been debited. The nonce is burned either way, so the client cannot fix
    // this by re-signing; only a human can. Past PENDING_TIMEOUT_MS this
    // becomes terminal and loud.
    if (pendingExpired(settlement)) {
      const abandoned = {
        ...settlement,
        status: "abandoned" as const,
        abandonedReason:
          "Submitted on-chain but never reached the required confirmation depth within " +
          `${Math.round(PENDING_TIMEOUT_MS / 60_000)} minutes. The transaction was most likely ` +
          "dropped or replaced. The EIP-3009 nonce is burned, so this cannot be retried by " +
          "re-signing the same authorization — it needs manual reconciliation against the chain.",
      };
      await recordSettlement(abandoned);
      log.error("x402 settlement abandoned", {
        tx: abandoned.transaction,
        network: abandoned.network,
        payer: abandoned.payer,
        amountAtomic: abandoned.amountAtomic,
      });
      return NextResponse.json(
        { settled: false, pending: false, abandoned: true, settlement: abandoned },
        { status: 409 }
      );
    }

    // Still genuinely pending (or the RPC is unavailable): report honestly; the
    // client keeps polling instead of re-signing a duplicate payment.
    return NextResponse.json(
      { settled: false, pending: true, settlement, confirmations: onChain?.confirmations ?? 0 },
      { status: 202 }
    );
  }

  // Terminal non-success states are not "settled". Saying so is the whole
  // point: a client that reads `settled: true` ships goods.
  if (settlement.status === "abandoned" || settlement.status === "replaced") {
    return NextResponse.json(
      { settled: false, pending: false, abandoned: settlement.status === "abandoned", settlement },
      { status: 409 }
    );
  }

  return NextResponse.json({ settled: true, settlement });
}
