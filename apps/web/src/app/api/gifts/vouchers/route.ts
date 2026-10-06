import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { withIdempotency } from "@/lib/idempotency";
import { createVoucher, listVouchers, voucherView, GIFTING_LIMITS } from "@/lib/services/gifting";
import { debitAsset, InsufficientFunds, p2pSettlementUnavailable } from "@/lib/services/p2pSettlement";
import { newTx, recordTransaction } from "@/lib/store";

export const dynamic = "force-dynamic";

const BuyGiftCard = z.object({
  token: z.enum(["USDC", "USDT"]),
  amount: z.number().positive().max(GIFTING_LIMITS.maxVoucherAmount),
});

// GET /api/gifts/vouchers — gift cards the caller bought, and ones they
// redeemed. The code comes back only for cards they bought — it is the bearer
// capability, and a redeemer no longer needs it.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "gifts.vouchers.list", { limit: 60, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const vouchers = listVouchers(userId).slice(0, 100).map((v) => voucherView(v, userId));
  return NextResponse.json({ vouchers, count: vouchers.length });
}

// POST /api/gifts/vouchers — buy a gift card.
//
// Only gift cards are purchasable here. Coupons are FurlPay's own promo spend
// and are issued out of band; letting a client mint one would be letting it
// mint money.
export async function POST(req: NextRequest) {
  const unavailable = p2pSettlementUnavailable();
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "gifts.vouchers.create", { limit: 10, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const body = await validateBody(req, BuyGiftCard);
  if (body instanceof NextResponse) return body;

  const idempotencyKey = req.headers.get("Idempotency-Key");
  return withIdempotency(idempotencyKey, "gifts.vouchers.create", async () => {
    const created = createVoucher(userId, { kind: "gift_card", token: body.token, amount: body.amount });
    if (!created.escrow) return NextResponse.json({ ok: false, error: "unfundable" }, { status: 400 });

    try {
      debitAsset(userId, created.escrow.token, created.escrow.amount);
    } catch (e) {
      const status = e instanceof InsufficientFunds ? 409 : 500;
      return NextResponse.json({ ok: false, error: "insufficient_balance" }, { status });
    }

    recordTransaction(
      userId,
      newTx({
        category: "transfer",
        direction: "out",
        title: "Gift card purchased",
        subtitle: `${body.amount} ${body.token}`,
        amountUsd: body.amount,
        token: body.token,
        chain: "arbitrum",
        status: "escrow",
      }),
    );

    return NextResponse.json(
      { ok: true, voucher: voucherView(created.voucher, userId), code: created.voucher.code },
      { status: 201 },
    );
  }, { principal: userId, request: body });
}
