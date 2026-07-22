import { NextRequest, NextResponse } from "next/server";
import { getSwapQuote, isTokenOnChain, usdPrice } from "@/lib/services/swap";
import {
  MAX_SLIPPAGE_PCT,
  issueQuote,
  redeemErrorMessage,
  redeemQuote,
} from "@/lib/services/swapQuote";
import { newTx, recordTransaction } from "@/lib/store";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { SwapSchema, parse } from "@/lib/schemas";
import type { Chain, Token } from "@/lib/types";

// /api/swaps — cheapest cross-chain swap routing (Li.Fi live quotes with a
// local fallback), Doc-2 canonical. Execution settles against the demo ledger.
//
// Two-phase, and deliberately so:
//   POST { fromToken, toToken, fromChain, amountIn, toChain? }
//     → { quote, quoteId, expiresAt }   — prices the route and issues an id
//   POST { execute: true, quoteId }
//     → { quote, executed }             — replays THAT quote, no re-pricing
//
// Execution used to re-send the original parameters and re-quote, which meant
// the price the user confirmed and the price they got were two separate reads
// of a moving market. `quoteId` is what ties them together.

// Pair rules zod can't express: token availability per chain + no-op swaps.
function validatePair(body: {
  fromToken: Token;
  toToken: Token;
  fromChain: Chain;
  toChain?: Chain;
}): string | null {
  if (!isTokenOnChain(body.fromToken, body.fromChain)) {
    return `${body.fromToken} is not available on ${body.fromChain}.`;
  }
  if (body.toChain && !isTokenOnChain(body.toToken, body.toChain)) {
    return `${body.toToken} is not available on ${body.toChain}.`;
  }
  if (body.fromToken === body.toToken && (body.toChain ?? body.fromChain) === body.fromChain) {
    return "Pick a different token or destination chain.";
  }
  return null;
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const parsed = parse(SwapSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  // Every quote is an outbound Li.Fi call, so quoting is the expensive half of
  // this route and the half an unauthenticated-feeling client hits on every
  // keystroke. Budget per user, above what live typing needs and well under
  // what a loop would consume.
  const limited = await rateLimitOr429(
    req,
    "swaps",
    { limit: 60, windowMs: 60_000 },
    account.user.id
  );
  if (limited) return limited;

  // Execution settles against the demo ledger only — Li.Fi provides quotes,
  // not execution, on this route. Gate on NODE_ENV (not INTEGRATION_MODE,
  // which is live in prod for the x402 rail but cannot make this route real):
  // in production, quotes stay available and execute refuses rather than
  // marking a fabricated swap "settled".
  if (body.execute && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "service_unavailable", detail: "Swap execution is not enabled on this deployment. Quotes remain available." },
      { status: 503 }
    );
  }

  // --- quote phase ---------------------------------------------------------
  if (body.execute !== true) {
    const invalid = validatePair(body);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const fresh = await getSwapQuote(body);
    if (fresh.slippagePct > MAX_SLIPPAGE_PCT) {
      // Refuse to issue at all rather than hand out an id for a price no user
      // should be asked to confirm.
      return NextResponse.json(
        {
          error: "slippage_too_high",
          detail: `This route quotes ${fresh.slippagePct}% slippage, above the ${MAX_SLIPPAGE_PCT}% limit.`,
        },
        { status: 503 }
      );
    }
    return NextResponse.json(await issueQuote(account.user.id, fresh));
  }

  // --- execution phase -----------------------------------------------------
  // The schema already guarantees a quoteId here: `execute: true` without one
  // fails validation, so re-quoting at execution time is not expressible.
  const redeemed = await redeemQuote(account.user.id, body.quoteId);
  if (!redeemed.ok) {
    // 409 for a spent id (the client should re-quote), 400 for the rest.
    const status = redeemed.reason === "already_used" ? 409 : 400;
    return NextResponse.json(
      { error: redeemed.reason, detail: redeemErrorMessage(redeemed.reason) },
      { status }
    );
  }
  const quote = redeemed.quote;

  {
    const usdIn = quote.amountIn * usdPrice(quote.fromToken);
    recordTransaction(
      account.user.id,
      newTx({
        category: "swap",
        direction: "in",
        title: `Swapped ${quote.fromToken} → ${quote.toToken}`,
        subtitle: `Li.Fi · ${quote.fromChain} → ${quote.toChain}`,
        amountUsd: usdIn,
        token: quote.toToken,
        chain: quote.toChain,
        status: "settled",
      })
    );

    const src = account.tokenBalances.find((b) => b.token === quote.fromToken && b.chain === quote.fromChain);
    if (src) {
      src.amount = Math.max(0, src.amount - quote.amountIn);
      src.usdValue = src.amount * usdPrice(src.token);
    }
    const dst = account.tokenBalances.find((b) => b.token === quote.toToken && b.chain === quote.toChain);
    if (dst) {
      dst.amount += quote.amountOut;
      dst.usdValue = dst.amount * usdPrice(dst.token);
    } else {
      account.tokenBalances.push({
        token: quote.toToken,
        chain: quote.toChain,
        amount: quote.amountOut,
        usdValue: quote.amountOut * usdPrice(quote.toToken),
      });
    }
  }

  return NextResponse.json({ quote, executed: true });
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const quote = await getSwapQuote({
    fromToken: (p.get("fromToken") as Token) ?? "USDT",
    toToken: (p.get("toToken") as Token) ?? "USDC",
    fromChain: (p.get("fromChain") as Chain) ?? "arbitrum",
    amountIn: Number(p.get("amountIn") ?? 100),
    toChain: (p.get("toChain") as Chain) ?? undefined,
  });
  return NextResponse.json({ quote });
}
