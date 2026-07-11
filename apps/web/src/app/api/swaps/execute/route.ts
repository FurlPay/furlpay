import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { buildSwapExecution } from "@/lib/services/swap";
import type { Chain, Token } from "@/lib/types";

export const dynamic = "force-dynamic";

// POST /api/swaps/execute — REAL swap execution via Li.Fi, non-custodial.
// Returns the route's unsigned transactionRequest (+ approvalAddress for
// ERC-20 sends) priced with the furlpay integrator fee; the USER's wallet
// signs and submits. Contrast /api/swaps { execute: true } — the demo-ledger
// simulation, which refuses in production.
// Only pairs LIFI_TOKEN maps are routable; EVM-only (Solana signing is a
// different flow and buildSwapExecution refuses it).
const TOKENS = ["USDC", "USDT", "DAI", "XSGD", "XUSD", "ETH"] as const;
const CHAINS = ["ethereum", "arbitrum", "base", "polygon", "robinhood"] as const;

const ExecuteSchema = z.object({
  fromToken: z.enum(TOKENS),
  toToken: z.enum(TOKENS),
  fromChain: z.enum(CHAINS),
  toChain: z.enum(CHAINS).optional(),
  amountIn: z.number().positive().max(1_000_000),
  fromAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  toAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "swaps.execute", { limit: 20, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, ExecuteSchema);
  if (body instanceof NextResponse) return body;

  const result = await buildSwapExecution({
    fromToken: body.fromToken as Token,
    toToken: body.toToken as Token,
    fromChain: body.fromChain as Chain,
    toChain: body.toChain as Chain | undefined,
    amountIn: body.amountIn,
    fromAddress: body.fromAddress,
    toAddress: body.toAddress,
  });
  if (!result.ok) {
    const status = result.error === "route_unavailable" ? 502 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, ...result.execution });
}
