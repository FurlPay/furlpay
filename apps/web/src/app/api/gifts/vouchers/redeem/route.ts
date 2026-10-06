import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { withIdempotency } from "@/lib/idempotency";
import { redeemVoucher, voucherView } from "@/lib/services/gifting";
import { creditAsset, unitUsdFor, p2pSettlementUnavailable } from "@/lib/services/p2pSettlement";
import { newTx, recordTransaction } from "@/lib/store";

export const dynamic = "force-dynamic";

const Redeem = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(8)
    .max(16)
    .regex(/^[A-Z0-9]+$/, "Invalid voucher code"),
});

// POST /api/gifts/vouchers/redeem — redeem a gift card or coupon code.
//
// Same enumeration exposure as the packet claim — a bearer code that pays out —
// so it gets the same tight budget.
export async function POST(req: NextRequest) {
  const unavailable = p2pSettlementUnavailable();
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "gifts.vouchers.redeem", { limit: 10, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const body = await validateBody(req, Redeem);
  if (body instanceof NextResponse) return body;

  const idempotencyKey = req.headers.get("Idempotency-Key");
  return withIdempotency(idempotencyKey, "gifts.vouchers.redeem", async () => {
    let result;
    try {
      result = redeemVoucher(body.code, userId);
    } catch (e) {
      const msg = (e as Error).message;
      return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
    }

    const { voucher, creditedAmount } = result;
    const unitUsd = unitUsdFor(voucher.purchaserId ?? userId, voucher.token);
    creditAsset(userId, voucher.token, creditedAmount, unitUsd);

    recordTransaction(
      userId,
      newTx({
        category: "transfer",
        direction: "in",
        title: voucher.kind === "gift_card" ? "Gift card redeemed" : "Coupon redeemed",
        subtitle: `${creditedAmount} ${voucher.token}`,
        amountUsd: Math.round(creditedAmount * unitUsd * 100) / 100,
        token: voucher.token,
        chain: "arbitrum",
        status: "settled",
      }),
    );

    return NextResponse.json({
      ok: true,
      creditedAmount,
      token: voucher.token,
      voucher: voucherView(voucher, userId),
    });
  }, { principal: userId, request: body });
}
