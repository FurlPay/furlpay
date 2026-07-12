import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { buildBurnBundle, buildMintTransaction, CCTP_DOMAINS } from "@/lib/services/cctpExecution";
import { capExceeded } from "@/lib/moneyLimits";
import { assertRailActive } from "@/lib/ops/controls";
import { recordTxEvent, recordSecurityEvent } from "@/lib/ops/events";
import type { Chain } from "@/lib/types";

export const dynamic = "force-dynamic";

// POST /api/intents/cctp — real CCTP V2 execution, non-custodial.
//
// action="burn": returns the UNSIGNED approve + depositForBurn calldata for
// the user's wallet/Safe to sign on the source chain (FurlPay never holds
// keys — same convention as /api/earn/deposit). action="mint": wraps a
// completed Iris attestation into the receiveMessage calldata for the
// destination chain. The attestation poll between the two is
// GET /api/intents/cctp/attestation.
const CCTP_CHAINS = Object.keys(CCTP_DOMAINS) as [Chain, ...Chain[]];

const BurnSchema = z.object({
  action: z.literal("burn"),
  sourceChain: z.enum(CCTP_CHAINS),
  destinationChain: z.enum(CCTP_CHAINS),
  amount: z.number().positive().max(1_000_000),
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  fast: z.boolean().optional(),
});
const MintSchema = z.object({
  action: z.literal("mint"),
  message: z.string().regex(/^0x[0-9a-fA-F]+$/),
  attestation: z.string().regex(/^0x[0-9a-fA-F]+$/),
});
const CctpSchema = z.discriminatedUnion("action", [BurnSchema, MintSchema]);

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "intents.cctp", { limit: 30, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const paused = await assertRailActive("cctp");
  if (paused) return paused;

  const body = await validateBody(req, CctpSchema);
  if (body instanceof NextResponse) return body;

  try {
    if (body.action === "burn") {
      if (body.sourceChain === body.destinationChain) {
        return NextResponse.json({ error: "source and destination must differ" }, { status: 400 });
      }
      // Hard server-side cap (FURLPAY_MAX_CCTP_USD, default $500).
      const cap = capExceeded("cctp", body.amount);
      if (cap) {
        await recordSecurityEvent({ rail: "cctp", kind: "amount_over_limit", severity: "low", detail: `cctp $${body.amount} > $${cap.capUsd}`, actor: auth.account.user.id });
        return NextResponse.json({ error: "amount_over_limit", detail: cap.error }, { status: 403 });
      }
      const bundle = buildBurnBundle({
        sourceChain: body.sourceChain,
        destinationChain: body.destinationChain,
        amount: body.amount,
        recipient: body.recipient as `0x${string}`,
        fast: body.fast ?? true,
      });
      await recordTxEvent({
        rail: "cctp", state: "prepared", substate: "BURN_PREPARED",
        amountUsd: body.amount, token: "USDC",
        sourceChain: body.sourceChain, destChain: body.destinationChain,
        recipient: body.recipient, userId: auth.account.user.id,
      });
      return NextResponse.json({ ok: true, bundle });
    }
    const tx = buildMintTransaction(body.message as `0x${string}`, body.attestation as `0x${string}`);
    await recordTxEvent({ rail: "cctp", state: "prepared", substate: "MINT_PREPARED", token: "USDC", userId: auth.account.user.id });
    return NextResponse.json({ ok: true, transaction: tx });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
