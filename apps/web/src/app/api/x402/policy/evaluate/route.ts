import { NextRequest, NextResponse } from "next/server";
import { parseUnits, keccak256, toHex, isAddress, type Address, type Hex } from "viem";
import { evaluatePolicy, guardStatus, GuardNotConfiguredError } from "@/lib/complianceGuard";

export const dynamic = "force-dynamic";

// POST /api/x402/policy/evaluate — non-interactive, read-only dry-run of the
// on-chain PolicyManager for a proposed payment. Returns PASS / FAIL / PENDING
// and the reason, without settling. This is the "compliance check" an agent (or
// the UI) runs before deciding how to pay.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { payer, recipient, amount, txId } = body as {
    payer?: string;
    recipient?: string;
    amount?: string; // USDC decimal string, e.g. "1500"
    txId?: string;
  };

  if (!payer || !isAddress(payer)) return NextResponse.json({ error: "valid payer required" }, { status: 400 });
  if (!recipient || !isAddress(recipient)) {
    return NextResponse.json({ error: "valid recipient required" }, { status: 400 });
  }
  if (!amount || !/^\d+(\.\d{1,6})?$/.test(amount)) {
    return NextResponse.json({ error: "amount must be a USDC decimal string" }, { status: 400 });
  }

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
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

// GET /api/x402/policy/evaluate — guard configuration / health.
export function GET() {
  return NextResponse.json(guardStatus());
}
