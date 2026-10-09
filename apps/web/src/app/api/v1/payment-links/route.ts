import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKey } from "@/lib/apiKeyAuth";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { getAccountDurable } from "@/lib/store";
import { audit } from "@/lib/audit";
import { createLink, listMerchant, MerchantUnavailable, paymentDetail } from "@/lib/payments/merchant/repository";
import { linkSchema, publicIntent, publicLink } from "@/lib/payments/merchant/model";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

// ---------------------------------------------------------------------------
// Merchant payment links over the API (Authorization: Bearer <secret key>).
//
//   POST /api/v1/payment-links          scope payments:create, LIVE secret key
//   GET  /api/v1/payment-links          scope payments:read,  secret/restricted key
//   GET  /api/v1/payment-links?id=<pi>  one payment with its events and receipts
//
// Same storage, validation and pricing as the dashboard (requestId is the
// idempotency key). Three deliberate refusals:
//   * test keys cannot create links: collection is mainnet-only, so a "test"
//     link would take real money;
//   * publishable (pk_) keys cannot read: they are public by design, and this
//     lists the merchant's payments;
//   * the merchant name shown to payers comes from the account, never the body,
//     so a key cannot present a checkout as another business.
// ---------------------------------------------------------------------------
const unavailable = () => NextResponse.json({ error: "merchant_payments_unavailable", message: "Merchant payments are not configured on this deployment." }, { status: 503, headers });

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "v1.payment-links.create", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const auth = await requireApiKey(req, { scope: "payments:create", environment: "live" });
  if (!auth.ok) return auth.res;
  const input = await validateBody(req, linkSchema);
  if (input instanceof NextResponse) return input;
  if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) return NextResponse.json({ error: "invalid_expiry", message: "expiresAt must be in the future" }, { status: 400, headers });
  try {
    const account = await getAccountDurable(auth.record.userId);
    const link = await createLink(auth.record.userId, account?.user.name || "FurlPay merchant", input);
    audit("merchant.link.api_created", auth.record.userId, { linkId: link.id, keyId: auth.record.keyId });
    return NextResponse.json({ link: { id: link.id, url: `/p/${link.slug}`, ...publicLink(link) } }, { status: 201, headers });
  } catch (e) {
    if (e instanceof MerchantUnavailable && e.message === "Request ID already in use") return NextResponse.json({ error: "request_id_conflict" }, { status: 409, headers });
    return unavailable();
  }
}

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "v1.payment-links.read", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const auth = await requireApiKey(req, { scope: "payments:read" });
  if (!auth.ok) return auth.res;
  if (auth.record.prefix === "pk") return NextResponse.json({ error: "secret_key_required", message: "Publishable keys cannot list payments." }, { status: 403, headers });
  const id = req.nextUrl.searchParams.get("id");
  if (id && !z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "invalid_id" }, { status: 400, headers });
  try {
    if (id) {
      const detail = await paymentDetail(auth.record.userId, id);
      return detail ? NextResponse.json({ payment: publicIntent(detail.intent), events: detail.events, receipts: detail.receipts }, { headers })
        : NextResponse.json({ error: "not_found" }, { status: 404, headers });
    }
    const { links, intents } = await listMerchant(auth.record.userId);
    return NextResponse.json({
      links: links.map(l => ({ id: l.id, url: `/p/${l.slug}`, ...publicLink(l) })),
      payments: intents.map(i => ({ linkId: i.link_id, ...publicIntent(i) })),
    }, { headers });
  } catch { return unavailable(); }
}
