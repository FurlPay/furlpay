import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import type { Hex } from "viem";
import { resolveEscrow, readEscrowEntry, guardStatus, GuardNotConfiguredError } from "@/lib/complianceGuard";
import { SettlementHaltedError } from "@/lib/settlementSafety";
import { requireOperator } from "@/lib/complianceOperator";

export const dynamic = "force-dynamic";

// POST /api/compliance/escrow/release — release an escrowed tranche to the
// recipient (requires the payer's on-chain SoF attestation).
// POST /api/compliance/escrow/refund  — refund an escrowed tranche to the payer
// after the release deadline. Both operator-gated (spend relayer gas).
// AGENTS rule 1: the body is Zod-validated (it was hand-parsed with a regex).
const EscrowActionSchema = z.object({
  txId: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "txId (bytes32 hex) required"),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const limited = await rateLimitOr429(req, "compliance.escrow.action", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const denied = requireOperator(req);
  if (denied) return denied;

  const { action } = await params;
  if (action !== "release" && action !== "refund") {
    return NextResponse.json({ error: "action must be release or refund" }, { status: 404 });
  }

  const body = await validateBody(req, EscrowActionSchema);
  if (body instanceof NextResponse) return body;
  const txId = body.txId;

  try {
    const res = await resolveEscrow(txId as Hex, action);
    const entry = await readEscrowEntry(txId as Hex);
    return NextResponse.json({ action, txId, ...res, entry, explorer: `https://arbiscan.io/tx/${res.txHash}` });
  } catch (e) {
    if (e instanceof GuardNotConfiguredError) {
      return NextResponse.json({ error: e.message, status: guardStatus() }, { status: 503 });
    }
    // Refused by the settlement circuit breaker BEFORE anything was signed.
    if (e instanceof SettlementHaltedError) {
      return NextResponse.json({ error: "settlement_halted", scope: e.scope }, { status: 503 });
    }
    // The relayer/RPC error stays in the server log; the caller gets a code.
    console.error(`[compliance/escrow] ${action} failed:`, (e as Error).message);
    return NextResponse.json({ error: "escrow_action_failed" }, { status: 502 });
  }
}
