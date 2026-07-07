import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import { readAttestation, guardStatus, GuardNotConfiguredError } from "@/lib/complianceGuard";

export const dynamic = "force-dynamic";

// GET /api/compliance/attestation/:tx — read the on-chain, transaction-linked
// compliance attestation (PASS / FAIL / PENDING) for a given txId. Read-only.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tx: string }> }) {
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
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
