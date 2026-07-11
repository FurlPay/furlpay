import { NextRequest, NextResponse } from "next/server";
import { planIntent } from "@/lib/services/intentRouter";
import { newTx, recordTransaction } from "@/lib/store";
import { IntentSchema, parse } from "@/lib/schemas";
import { requireUser } from "@/lib/authz";

// POST /api/intents — plan (and optionally execute) a cross-chain intent for
// the SESSION user. The router picks CCTP V2 for native USDC and Li.Fi for
// everything else. body: Intent & { execute?: boolean }
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const parsed = parse(IntentSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  let plan;
  try {
    plan = planIntent(body);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  // Execution below settles against the demo ledger only. In production,
  // plans stay available and execute refuses (same guard class as swaps/
  // offramp); real CCTP execution lives at /api/intents/cctp (non-custodial
  // calldata the user signs).
  if (body.execute && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "service_unavailable", detail: "Intent execution is not enabled on this deployment. Plans remain available; use /api/intents/cctp for real CCTP transfers." },
      { status: 503 }
    );
  }

  if (body.execute) {
    recordTransaction(
      account.user.id,
      newTx({
        category: "swap",
        direction: "in",
        title: `${body.fromToken} → ${body.toToken}`,
        subtitle: `${plan.rail === "cctp-v2" ? "CCTP V2" : "Li.Fi"} · ${body.fromChain} → ${body.toChain}`,
        amountUsd: plan.amountIn,
        token: body.toToken,
        chain: body.toChain,
        status: "settled",
      })
    );

    const src = account.tokenBalances.find((b) => b.token === body.fromToken && b.chain === body.fromChain);
    if (src) {
      src.amount = Math.max(0, src.amount - plan.amountIn);
      src.usdValue = src.amount;
    }
    const dst = account.tokenBalances.find((b) => b.token === body.toToken && b.chain === body.toChain);
    if (dst) {
      dst.amount += plan.amountOut;
      dst.usdValue = dst.amount;
    } else {
      account.tokenBalances.push({ token: body.toToken, chain: body.toChain, amount: plan.amountOut, usdValue: plan.amountOut });
    }
  }

  return NextResponse.json({ plan, executed: !!body.execute });
}
