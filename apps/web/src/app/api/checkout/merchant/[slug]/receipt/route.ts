import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { sbSelect } from "@/lib/supabase";
import { getIntent, getLink } from "@/lib/payments/merchant/repository";
import { receiptPdf, ReceiptUnavailable } from "@/lib/payments/merchant/receipt";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ slug: string }> };
// GET ?intent=<checkout id>: the PAYER's receipt. Same capability as the checkout status
// (slug + random checkout id); no fee or net, which are the merchant's business.
export async function GET(req: NextRequest, ctx: Context) {
  const limited = await rateLimitOr429(req, "merchant.checkout.receipt", { limit: 20, windowMs: 60_000 }); if (limited) return limited;
  const { slug } = await ctx.params;
  const id = req.nextUrl.searchParams.get("intent");
  if (!/^[A-Za-z0-9_-]{24}$/.test(slug) || !id || !z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  try {
    const link = await getLink(slug);
    const intent = link ? await getIntent(id, link.id) : null;
    if (!link || !intent) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    const receipts = await sbSelect<{ tx_hash: string; amount_units: string; observed_at: string }>("merchant_payment_receipts", `intent_id=eq.${intent.id}&select=tx_hash,amount_units,observed_at&order=created_at.asc&limit=100`);
    const pdf = receiptPdf(intent, link, receipts, "payer");
    return new NextResponse(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="receipt-${id.slice(0, 8)}.pdf"`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (e) {
    if (e instanceof ReceiptUnavailable) return NextResponse.json({ error: e.message }, { status: 409 });
    return NextResponse.json({ error: "Receipts are unavailable right now." }, { status: 503 });
  }
}
