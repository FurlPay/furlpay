import { NextRequest, NextResponse } from "next/server";
import { quoteSwap } from "@/lib/services/swap";
import { newTx, recordTransaction } from "@/lib/store";
import { requireUser } from "@/lib/authz";

// /api/swaps — cheapest cross-chain swap routing (Li.Fi / 1inch), Doc-2 canonical.
// POST body: { fromToken, toToken, fromChain, amountIn, toChain?, execute? }
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const body = await req.json();
  const quote = quoteSwap(body);

  if (body.execute) {
    recordTransaction(
      account.user.id,
      newTx({
        category: "swap",
        direction: "in",
        title: `Swapped ${quote.fromToken} → ${quote.toToken}`,
        subtitle: `Li.Fi · ${quote.fromChain} → ${quote.toChain}`,
        amountUsd: quote.amountIn,
        token: quote.toToken,
        chain: quote.toChain,
        status: "settled",
      })
    );

    const src = account.tokenBalances.find((b) => b.token === quote.fromToken && b.chain === quote.fromChain);
    if (src) {
      src.amount = Math.max(0, src.amount - quote.amountIn);
      src.usdValue = src.amount;
    }
    const dst = account.tokenBalances.find((b) => b.token === quote.toToken && b.chain === quote.toChain);
    if (dst) {
      dst.amount += quote.amountOut;
      dst.usdValue = dst.amount;
    } else {
      account.tokenBalances.push({ token: quote.toToken, chain: quote.toChain, amount: quote.amountOut, usdValue: quote.amountOut });
    }
  }

  return NextResponse.json({ quote, executed: !!body.execute });
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const quote = quoteSwap({
    fromToken: (p.get("fromToken") as any) ?? "USDT",
    toToken: (p.get("toToken") as any) ?? "USDC",
    fromChain: (p.get("fromChain") as any) ?? "arbitrum",
    amountIn: Number(p.get("amountIn") ?? 100),
    toChain: (p.get("toChain") as any) ?? undefined,
  });
  return NextResponse.json({ quote });
}
