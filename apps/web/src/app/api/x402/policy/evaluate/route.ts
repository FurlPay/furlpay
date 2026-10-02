import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { z } from "zod";
import { parseUnits, keccak256, toHex, isAddress, type Address, type Hex } from "viem";
import { evaluatePolicy, guardStatus, GuardNotConfiguredError } from "@/lib/complianceGuard";
import { validateBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

const UsdcDecimal = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,6})?$/, "amount must be a USDC decimal string")
  .refine((value) => Number(value) > 0 && Number(value) <= 1_000_000, "amount must be between 0 and 1,000,000 USDC");

const PolicyEvaluateBody = z.object({
  payer: z.string().refine(isAddress, "valid payer required"),
  recipient: z.string().refine(isAddress, "valid recipient required"),
  amount: UsdcDecimal,
  txId: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
});

// POST /api/x402/policy/evaluate — non-interactive, read-only dry-run of the
// on-chain PolicyManager for a proposed payment. Returns PASS / FAIL / PENDING
// and the reason, without settling. This is the "compliance check" an agent (or
// the UI) runs before deciding how to pay.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "x402.policy.evaluate.post", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, PolicyEvaluateBody);
  if (body instanceof NextResponse) return body;
  const { payer, recipient, amount, txId } = body;

  const id = (txId && /^0x[0-9a-fA-F]{64}$/.test(txId) ? txId : keccak256(toHex(`${payer}:${recipient}:${amount}:${Date.now()}`))) as Hex;

  try {
    const result = await evaluatePolicy({
      payer: payer as Address,
      recipient: recipient as Address,
      amount: parseUnits(amount, 6),
      txId: id,
    });
    return NextResponse.json({ ...result, txId: id, chain: "arbitrum" });
  } catch (e) {
    if (e instanceof GuardNotConfiguredError) {
      return NextResponse.json({ error: e.message, status: guardStatus() }, { status: 503 });
    }
    console.error("[x402/policy/evaluate] failed:", (e as Error).message);
    return NextResponse.json({ error: "policy_evaluation_failed" }, { status: 502 });
  }
}

// GET /api/x402/policy/evaluate — guard configuration / health.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "x402.policy.evaluate", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  return NextResponse.json(guardStatus());
}
