import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { isAddress, type Address, type Hex } from "viem";
import {
  settleWithPolicy,
  settleTranche,
  readAttestation,
  guardStatus,
  GuardNotConfiguredError,
  type Authorization,
} from "@/lib/complianceGuard";
import { requireOperator } from "@/lib/complianceOperator";

export const dynamic = "force-dynamic";

// POST /api/x402/policy/settle — submit a payer-signed EIP-3009 authorization
// through the X402PolicyWrapper. The wrapper evaluates policy and settles only
// on PASS; on PENDING the caller instead provides a tranche split. Every call
// writes a transaction-linked attestation on-chain. Operator-gated (spends
// relayer gas).
//
// Body:
//   { mode: "single", from, to, resource, txId, auth }
//   { mode: "tranche", from, to, resource, txId, releaseDeadline, compliantAuth, escrowAuth }
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "x402.policy.settle", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const denied = requireOperator(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const { mode, from, to, resource, txId } = body as Record<string, string>;

  if (!from || !isAddress(from)) return NextResponse.json({ error: "valid from required" }, { status: 400 });
  if (!to || !isAddress(to)) return NextResponse.json({ error: "valid to required" }, { status: 400 });
  if (!txId || !/^0x[0-9a-fA-F]{64}$/.test(txId)) {
    return NextResponse.json({ error: "txId (bytes32 hex) required" }, { status: 400 });
  }

  function toAuth(a: any): Authorization {
    return {
      value: BigInt(a.value),
      validAfter: BigInt(a.validAfter),
      validBefore: BigInt(a.validBefore),
      nonce: a.nonce as Hex,
      v: Number(a.v),
      r: a.r as Hex,
      s: a.s as Hex,
    };
  }

  try {
    if (mode === "tranche") {
      const { compliantAuth, escrowAuth, releaseDeadline } = body as any;
      if (!compliantAuth || !escrowAuth || !releaseDeadline) {
        return NextResponse.json({ error: "compliantAuth, escrowAuth, releaseDeadline required" }, { status: 400 });
      }
      const res = await settleTranche({
        from: from as Address,
        to: to as Address,
        compliantAuth: toAuth(compliantAuth),
        escrowAuth: toAuth(escrowAuth),
        resource: resource ?? "",
        txId: txId as Hex,
        releaseDeadline: BigInt(releaseDeadline),
      });
      const attestation = await readAttestation(txId as Hex);
      return NextResponse.json({ mode, ...res, attestation, explorer: `https://arbiscan.io/tx/${res.txHash}` });
    }

    const { auth } = body as any;
    if (!auth) return NextResponse.json({ error: "auth required" }, { status: 400 });
    const res = await settleWithPolicy({
      from: from as Address,
      to: to as Address,
      auth: toAuth(auth),
      resource: resource ?? "",
      txId: txId as Hex,
    });
    const attestation = await readAttestation(txId as Hex);
    return NextResponse.json({ mode: "single", ...res, attestation, explorer: `https://arbiscan.io/tx/${res.txHash}` });
  } catch (e) {
    if (e instanceof GuardNotConfiguredError) {
      return NextResponse.json({ error: e.message, status: guardStatus() }, { status: 503 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
