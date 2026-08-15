import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import type { Hex } from "viem";
import { resolveEscrow, readEscrowEntry, guardStatus, GuardNotConfiguredError } from "@/lib/complianceGuard";
import { requireOperator } from "@/lib/complianceOperator";

export const dynamic = "force-dynamic";

// POST /api/compliance/escrow/release — release an escrowed tranche to the
// recipient (requires the payer's on-chain SoF attestation).
// POST /api/compliance/escrow/refund  — refund an escrowed tranche to the payer
// after the release deadline. Both operator-gated (spend relayer gas).
export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const limited = await rateLimitOr429(req, "compliance.escrow.action", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const denied = requireOperator(req);
  if (denied) return denied;

  const { action } = await params;
  if (action !== "release" && action !== "refund") {
    return NextResponse.json({ error: "action must be release or refund" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const txId = body.txId as string | undefined;
  if (!txId || !/^0x[0-9a-fA-F]{64}$/.test(txId)) {
    return NextResponse.json({ error: "txId (bytes32 hex) required" }, { status: 400 });
  }

  try {
    const res = await resolveEscrow(txId as Hex, action);
    const entry = await readEscrowEntry(txId as Hex);
    return NextResponse.json({ action, txId, ...res, entry, explorer: `https://arbiscan.io/tx/${res.txHash}` });
  } catch (e) {
    if (e instanceof GuardNotConfiguredError) {
      return NextResponse.json({ error: e.message, status: guardStatus() }, { status: 503 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
