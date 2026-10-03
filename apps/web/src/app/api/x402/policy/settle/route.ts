import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/validate";
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
import { SettlementHaltedError } from "@/lib/settlementSafety";

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
// AGENTS rule 1. The body was destructured from req.json() and checked field by
// field; `releaseDeadline` went through a bare BigInt(), which reads "" as 0n
// (an escrow refundable immediately), and nonce/r/s/v were passed to the
// contract call unchecked. Every field is now validated at the boundary.
// Amount-like fields keep the repository's canonical atomic rule
// (parseAtomicAmount) so the 400 "invalid_amount" contract is unchanged.
const Addr = z.string().refine((v) => isAddress(v), "valid address required");
const Bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "bytes32 hex required");
const Atomic = z.unknown();
const AuthSchema = z.object({
  value: Atomic,
  validAfter: Atomic,
  validBefore: Atomic,
  nonce: Bytes32,
  v: z.coerce.number().int().refine((n): boolean => n === 27 || n === 28 || n === 0 || n === 1, "v must be 27/28 (or 0/1)"),
  r: Bytes32,
  s: Bytes32,
});
const Base = { from: Addr, to: Addr, txId: Bytes32, resource: z.string().max(2048).optional() };
const SettleSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("single"), ...Base, auth: AuthSchema }),
  z.object({
    mode: z.literal("tranche"),
    ...Base,
    compliantAuth: AuthSchema,
    escrowAuth: AuthSchema,
    releaseDeadline: z.string().refine((v) => parseAtomicAmount(v) !== null && parseAtomicAmount(v)! > 0n, "releaseDeadline must be a positive canonical integer"),
  }),
]);

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

  const body = await validateBody(req, SettleSchema);
  if (body instanceof NextResponse) return body;
  const { mode, from, to, resource, txId } = body;

  // F-20. `a` is a raw request body, and these were bare `BigInt(...)` calls —
  // which accept hex, octal, binary, a leading sign, whitespace, and the empty
  // string as ZERO. `parseAtomicAmount` is the repository's one rule for what an
  // atomic amount looks like (F-9); anything else is refused rather than
  // reinterpreted on its way to a contract call.
  function toAuth(a: z.infer<typeof AuthSchema>): Authorization {
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
    if (body.mode === "tranche") {
      const { compliantAuth, escrowAuth, releaseDeadline } = body;
      const res = await settleTranche({
        from: from as Address,
        to: to as Address,
        compliantAuth: toAuth(compliantAuth),
        escrowAuth: toAuth(escrowAuth),
        resource: resource ?? "",
        txId: txId as Hex,
        releaseDeadline: parseAtomicAmount(releaseDeadline)!,
      });
      const attestation = await readAttestation(txId as Hex);
      return NextResponse.json({ mode, ...res, attestation, explorer: `https://arbiscan.io/tx/${res.txHash}` });
    }

    const { auth } = body;
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
    // Refused by the settlement circuit breaker BEFORE anything was signed.
    if (e instanceof SettlementHaltedError) {
      return NextResponse.json({ error: "settlement_halted", scope: e.scope }, { status: 503 });
    }
    // A malformed amount is the CLIENT's error, not an upstream failure. 502
    // would tell the caller to retry something that can never succeed, and
    // retry-on-502 is exactly what a client library does by default.
    if (e instanceof InvalidAuthorizationAmount) {
      return NextResponse.json({ error: "invalid_amount", message: e.message }, { status: 400 });
    }
    console.error("[x402/policy/settle] failed:", (e as Error).message);
    return NextResponse.json({ error: "settlement_failed" }, { status: 502 });
  }
}
