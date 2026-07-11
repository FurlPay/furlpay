import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { fetchAttestation } from "@/lib/services/cctpExecution";

export const dynamic = "force-dynamic";

// GET /api/intents/cctp/attestation?sourceDomain=3&txHash=0x… — poll Circle's
// Iris for the burn's message + attestation. 200 {status:"pending"} until the
// finality threshold is reached, then {status:"complete", message, attestation}
// ready for the mint leg (POST /api/intents/cctp action="mint").
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const p = req.nextUrl.searchParams;
  const sourceDomain = Number(p.get("sourceDomain"));
  const txHash = p.get("txHash") || "";
  if (!Number.isInteger(sourceDomain) || sourceDomain < 0 || sourceDomain > 20) {
    return NextResponse.json({ error: "invalid sourceDomain" }, { status: 400 });
  }

  try {
    const attestation = await fetchAttestation(sourceDomain, txHash);
    return NextResponse.json(attestation, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: msg === "invalid txHash" ? 400 : 502 });
  }
}
