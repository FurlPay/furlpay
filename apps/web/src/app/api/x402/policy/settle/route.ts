import { NextRequest, NextResponse } from "next/server";
import { parseAtomicAmount } from "@/lib/x402Assets";
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
/** A malformed numeric field in a presented authorization. Refused, never coerced. */
class InvalidAuthorizationAmount extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAuthorizationAmount";
  }
}

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

  // F-20. `a` is a raw request body, and these were bare `BigInt(...)` calls —
  // which accept hex, octal, binary, a leading sign, whitespace, and the empty
  // string as ZERO. `parseAtomicAmount` is the repository's one rule for what an
  // atomic amount looks like (F-9); anything else is refused rather than
  // reinterpreted on its way to a contract call.
  function toAuth(a: any): Authorization {
    const value = parseAtomicAmount(a?.value);
    const validAfter = parseAtomicAmount(a?.validAfter);
    const validBefore = parseAtomicAmount(a?.validBefore);
    if (value === null || validAfter === null || validBefore === null) {
      throw new InvalidAuthorizationAmount(
        `authorization carries a non-canonical numeric field (value=${JSON.stringify(a?.value)})`
      );
    }
    return {
      value,
      validAfter,
      validBefore,
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
    // A malformed amount is the CLIENT's error, not an upstream failure. 502
    // would tell the caller to retry something that can never succeed, and
    // retry-on-502 is exactly what a client library does by default.
    if (e instanceof InvalidAuthorizationAmount) {
      return NextResponse.json({ error: "invalid_amount", message: e.message }, { status: 400 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
