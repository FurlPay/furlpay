import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { cancelRefund, listRefunds, RefundRejected, refundRequestSchema, requestRefund } from "@/lib/payments/merchant/refunds";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const fail = (e: unknown) => e instanceof RefundRejected
  ? NextResponse.json({ error: e.message }, { status: 409, headers })
  : NextResponse.json({ error: "Refunds are unavailable. Configure storage and apply migration 0045." }, { status: 503, headers });

// Merchant refunds. POST reserves the amount in the ledger immediately; FurlPay
// operations approve it and the custody provider sends it; it completes only when
// the transfer is read on-chain. The merchant is always the signed-in account.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "merchant.refunds.read", { limit: 60, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  const intentId = req.nextUrl.searchParams.get("intentId");
  if (intentId && !z.string().uuid().safeParse(intentId).success) return NextResponse.json({ error: "Invalid payment ID" }, { status: 400, headers });
  try { return NextResponse.json({ refunds: await listRefunds(auth.account.user.id, intentId ?? undefined) }, { headers }); } catch (e) { return fail(e); }
}
export async function POST(req: NextRequest) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  // Money-moving: a tight per-merchant budget on top of the middleware baseline.
  const limited = await rateLimitOr429(req, "merchant.refunds.create", { limit: 10, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  const input = await validateBody(req, refundRequestSchema); if (input instanceof NextResponse) return input;
  try { return NextResponse.json({ refund: await requestRefund(auth.account.user.id, auth.account.user.id, input) }, { status: 201, headers }); } catch (e) { return fail(e); }
}
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "merchant.refunds.cancel", { limit: 20, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid refund ID" }, { status: 400, headers });
  try { return NextResponse.json({ refund: await cancelRefund(auth.account.user.id, id) }, { headers }); } catch (e) { return fail(e); }
}
