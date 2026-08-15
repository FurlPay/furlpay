import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { isAddress, type Address, type Hex } from "viem";
import {
  hashSoFEvidence,
  validateSoFEvidence,
  SOF_ATTESTATION_TTL_SECONDS,
  type SoFEvidence,
} from "@furlpay/compliance";
import { recordSoF, guardStatus, GuardNotConfiguredError } from "@/lib/complianceGuard";
import { requireOperator } from "@/lib/complianceOperator";

export const dynamic = "force-dynamic";

// POST /api/compliance/attestation/source-of-funds — the compliance operator
// records an on-chain source-of-funds attestation for a payer after reviewing
// off-chain evidence. Stores only a hash of the evidence on-chain. Operator-
// gated (writes an authoritative attestation). This is what unblocks a PENDING
// payment / lets the ComplianceEscrow release.
//
// Body: a full SoFEvidence object, or { subject, evidenceHash, expiry? }.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "compliance.attestation.source.of.funds", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const denied = requireOperator(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  let subject: string | undefined = body.subject;
  let evidenceHash: string | undefined = body.evidenceHash;
  let expiry: number | undefined = body.expiry;

  // If a full evidence object was provided, derive the hash canonically.
  if (!evidenceHash && body.evidence) {
    const evidence = body.evidence as SoFEvidence;
    try {
      validateSoFEvidence(evidence);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
    subject = evidence.subject;
    evidenceHash = hashSoFEvidence(evidence);
  }

  if (!subject || !isAddress(subject)) {
    return NextResponse.json({ error: "valid subject address required" }, { status: 400 });
  }
  if (!evidenceHash || !/^0x[0-9a-fA-F]{64}$/.test(evidenceHash)) {
    return NextResponse.json({ error: "evidenceHash (bytes32) or evidence object required" }, { status: 400 });
  }

  const exp = BigInt(expiry ?? Math.floor(Date.now() / 1000) + SOF_ATTESTATION_TTL_SECONDS);

  try {
    const res = await recordSoF(subject as Address, evidenceHash as Hex, exp);
    return NextResponse.json({
      subject,
      evidenceHash,
      expiry: Number(exp),
      ...res,
      explorer: `https://arbiscan.io/tx/${res.txHash}`,
    });
  } catch (e) {
    if (e instanceof GuardNotConfiguredError) {
      return NextResponse.json({ error: e.message, status: guardStatus() }, { status: 503 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
