import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import type { Hex } from "viem";
import { readAttestation, guardStatus, GuardNotConfiguredError } from "@/lib/complianceGuard";

export const dynamic = "force-dynamic";

// GET /api/compliance/attestation/:tx — read the on-chain, transaction-linked
// compliance attestation (PASS / FAIL / PENDING) for a given txId. Read-only.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tx: string }> }) {
  const limited = await rateLimitOr429(req, "compliance.attestation.tx", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const { tx } = await params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) {
    return NextResponse.json({ error: "tx must be a bytes32 hex id" }, { status: 400 });
  }
  try {
    const attestation = await readAttestation(tx as Hex);
    return NextResponse.json({ txId: tx, ...attestation });
  } catch (e) {
    if (e instanceof GuardNotConfiguredError) {
      return NextResponse.json({ error: e.message, status: guardStatus() }, { status: 503 });
    }
    console.error("[compliance/attestation] read failed:", (e as Error).message);
    return NextResponse.json({ error: "attestation_unavailable" }, { status: 502 });
  }
}
