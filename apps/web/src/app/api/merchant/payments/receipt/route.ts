import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { sbSelect } from "@/lib/supabase";
import { paymentDetail } from "@/lib/payments/merchant/repository";
import { receiptPdf, ReceiptUnavailable } from "@/lib/payments/merchant/receipt";
import type { MerchantLink } from "@/lib/payments/merchant/model";
export const dynamic = "force-dynamic";
// GET ?id=<payment>: the merchant's PDF receipt (with fee and net) for a verified payment.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "merchant.receipt", { limit: 30, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid payment ID" }, { status: 400 });
  try {
    const detail = await paymentDetail(auth.account.user.id, id);
    if (!detail) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    const [link] = await sbSelect<MerchantLink>("merchant_payment_links", `id=eq.${detail.intent.link_id}&merchant_id=eq.${auth.account.user.id}&limit=1`);
    const pdf = receiptPdf(detail.intent, link, detail.receipts, "merchant");
    return new NextResponse(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="furlpay-receipt-${id.slice(0, 8)}.pdf"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ReceiptUnavailable) return NextResponse.json({ error: e.message }, { status: 409 });
    return NextResponse.json({ error: "Receipts are unavailable right now." }, { status: 503 });
  }
}
