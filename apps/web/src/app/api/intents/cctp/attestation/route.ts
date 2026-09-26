import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { recordRailHealth } from "@/lib/ops/overview";
import { CCTP_DOMAINS, fetchAttestation } from "@/lib/services/cctpExecution";

/**
 * The domains this deployment can actually settle, derived from the same table
 * the burn leg builds against.
 *
 * This guard used to be `sourceDomain > 20`, an arbitrary ceiling that silently
 * became wrong the day Arc (domain 26) was added to CCTP_DOMAINS. The effect
 * was not a cosmetic 400: Arc is quotable in `CCTP_CHAINS` and executable in
 * `CCTP_DOMAINS`, so a caller could price an Arc transfer, burn the USDC — a
 * burn is irreversible — and then be refused the attestation needed to mint it,
 * with no path to the funds through our own API.
 *
 * Deriving the set rather than widening the number means the bound cannot drift
 * from what we support again, in either direction: a domain Circle adds that we
 * do not execute stays rejected, and one we do execute is accepted the moment
 * it lands in the table.
 */
const SUPPORTED_DOMAINS = new Set<number>(
  Object.values(CCTP_DOMAINS).filter((d): d is number => typeof d === "number")
);

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
  if (!Number.isInteger(sourceDomain) || !SUPPORTED_DOMAINS.has(sourceDomain)) {
    return NextResponse.json({ error: "invalid sourceDomain" }, { status: 400 });
  }

  try {
    const started = Date.now();
    const attestation = await fetchAttestation(sourceDomain, txHash);
    await recordRailHealth("cctp", "HEALTHY", undefined, Date.now() - started);
    return NextResponse.json(attestation, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg !== "invalid txHash") await recordRailHealth("cctp", "DEGRADED", msg);
    return NextResponse.json({ error: msg }, { status: msg === "invalid txHash" ? 400 : 502 });
  }
}
