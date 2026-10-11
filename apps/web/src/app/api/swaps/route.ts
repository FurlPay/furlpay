import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/validate";
import { getSwapQuote, isTokenOnChain, usdPrice } from "@/lib/services/swap";
import {
  MAX_SLIPPAGE_PCT,
  issueQuote,
  redeemErrorMessage,
  redeemQuote,
  peekQuote,
} from "@/lib/services/swapQuote";
import { newTx, recordTransaction } from "@/lib/store";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { enforceActionStepUp } from "@/lib/biometrics/enforceStepUp";
import { SwapSchema, parse } from "@/lib/schemas";
import type { Chain, Token } from "@/lib/types";
import { recordRevenue, usdFromFloat } from "@/lib/revenue/record";
import { log } from "@/lib/log";

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

  // Kept alongside the parsed copy: the step-up digest is committed over what the
  // client SENT, and Zod applies defaults and coercions. Re-deriving from
  // `parsed.data` would hash a body the client never had.
  const rawBody = await readJsonBody(req).catch(() => ({}));
  const parsed = parse(SwapSchema, rawBody);
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
  //
  // Step-up BEFORE redeeming. A refusal after redemption would spend the quote
  // and leave the user re-quoting at a new price for an approval they never got
  // to give.
  //
  // Bound to the request body, which carries the quoteId — and a quoteId is
  // server-issued and single-use, so the digest pins this execution to that
  // exact quote. Quoting itself is not gated: it moves nothing.
  //
  // Valued from the STORED quote, not from the request body. On the execute
  // branch the client sends a quoteId and need not resend `amountIn`/`fromToken`
  // at all — reading them from the body would let a client under-declare its own
  // swap to duck the threshold. `peekQuote` does not consume the id.
  //
  // A quote that cannot be read is priced as infinite rather than unknown:
  // `requiresStepUp` treats a missing amount as sub-threshold, so `undefined`
  // here would fail OPEN. `redeemQuote` below reports the real reason.
  const pending = await peekQuote(account.user.id, body.quoteId);
  const swapUsd = pending
    ? pending.amountIn * usdPrice(pending.fromToken)
    : Number.POSITIVE_INFINITY;

  const stepUp = await enforceActionStepUp({
    userId: account.user.id,
    action: "swap",
    amountUsd: swapUsd,
    endpoint: "/swaps",
    method: "POST",
    body: rawBody as Record<string, never>,
    proofId: (rawBody as { stepUpProofId?: unknown }).stepUpProofId,
  });
  if (stepUp) return stepUp;

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

  // Revenue telemetry for the swap engine.
  //
  // status is ALWAYS "simulated" here, and that is not a placeholder: this
  // branch refuses outright when NODE_ENV is production (the guard near the
  // top), so by construction nothing it books is collectible. Recording it
  // keeps the shape of the flow visible without it ever counting as revenue.
  //
  // The REAL Li.Fi integrator fee is deliberately NOT recorded anywhere yet.
  // /api/swaps/execute returns unsigned calldata — FurlPay never learns whether
  // the user broadcast it — and /api/swaps/status observes a confirmed hash but
  // carries no fee figure. Booking at either point would be a guess. Closing it
  // needs a quoteId -> txHash mapping written at execute time and read back on
  // the DONE observation; see docs/REVENUE.md.
  //
  // Keyed on the quoteId, which redeemQuote() has already made single-use, so a
  // retry cannot double-book.
  await recordRevenue({
    source: "swap_integrator_fee",
    status: "simulated",
    externalRef: body.quoteId ?? `${account.user.id}:${quote.fromToken}:${quote.amountIn}`,
    fee: usdFromFloat(quote.feeUsd),
    volume: usdFromFloat(quote.amountIn * usdPrice(quote.fromToken)),
    userId: account.user.id,
    chain: quote.fromChain,
    metadata: {
      fromToken: quote.fromToken,
      toToken: quote.toToken,
      fromChain: quote.fromChain,
      toChain: quote.toChain,
      // "lifi" = priced by a real upstream quote, "mock" = local fallback.
      // Either way the EXECUTION is simulated; this records which pricing
      // produced the numbers.
      quoteSource: quote.source,
    },
  }).catch((e) => log.error("swap revenue telemetry failed", { error: (e as Error).message }));

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
