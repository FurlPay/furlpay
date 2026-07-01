import { NextRequest, NextResponse } from "next/server";
import { Intent, planIntent } from "@/lib/services/intentRouter";
import { db, newTx, recordTransaction } from "@/lib/store";

// POST /api/intents — plan (and optionally execute) a cross-chain intent.
// The router picks CCTP V2 for native USDC and Li.Fi for everything else.
// body: Intent & { execute?: boolean }
export async function POST(req: NextRequest) {
  const body = (await req.json()) as Intent & { execute?: boolean };

  if (!body.fromToken || !body.toToken || !body.fromChain || !body.toChain || !(body.amount > 0)) {
    return NextResponse.json(
      { error: "fromToken, toToken, fromChain, toChain and positive amount are required" },
      { status: 400 }
    );
  }

  let plan;
  try {
    plan = planIntent(body);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  if (body.execute) {
    recordTransaction(
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

    const src = db.tokenBalances.find((b) => b.token === body.fromToken && b.chain === body.fromChain);
    if (src) {
      src.amount = Math.max(0, src.amount - plan.amountIn);
      src.usdValue = src.amount;
    }
    const dst = db.tokenBalances.find((b) => b.token === body.toToken && b.chain === body.toChain);
    if (dst) {
      dst.amount += plan.amountOut;
      dst.usdValue = dst.amount;
    } else {
      db.tokenBalances.push({ token: body.toToken, chain: body.toChain, amount: plan.amountOut, usdValue: plan.amountOut });
    }
  }

  return NextResponse.json({ plan, executed: !!body.execute });
}
