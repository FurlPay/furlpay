import { NextRequest, NextResponse } from "next/server";
import { p2pUnavailable } from "@/lib/services/p2pSettlement";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { getAd, editAd, closeAd, publicAd, P2P_LIMITS } from "@/lib/services/p2p";

export const dynamic = "force-dynamic";

const EditAd = z
  .object({
    price: z.number().positive().max(P2P_LIMITS.maxPrice).optional(),
    minFiat: z.number().positive().max(P2P_LIMITS.maxFiatPerOrder).optional(),
    maxFiat: z.number().positive().max(P2P_LIMITS.maxFiatPerOrder).optional(),
    terms: z.string().trim().max(500).optional(),
    paymentWindowMins: z
      .number()
      .int()
      .min(P2P_LIMITS.minPaymentWindowMins)
      .max(P2P_LIMITS.maxPaymentWindowMins)
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No fields to update");

// GET /api/p2p/ads/:id — one ad, redacted. Public like the listing.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const unavailable = p2pUnavailable();
  if (unavailable) return unavailable;

  const limited = await rateLimitOr429(req, "p2p.ads.get", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const { id } = await props.params;
  const ad = getAd(id);
  if (!ad) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ad: publicAd(ad) });
}

// PATCH /api/p2p/ads/:id — reprice or retime. Owner only. The amount is not
// editable: it is the escrow basis for orders already open against the ad.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const unavailable = p2pUnavailable();
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "p2p.ads.edit", { limit: 30, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, EditAd);
  if (body instanceof NextResponse) return body;

  const { id } = await props.params;
  try {
    const ad = editAd(auth.account.user.id, id, body);
    return NextResponse.json({ ok: true, ad: publicAd(ad) });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 400 });
  }
}

// DELETE /api/p2p/ads/:id — delist. Orders already open against it still run to
// completion; only new orders are refused.
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const unavailable = p2pUnavailable();
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "p2p.ads.close", { limit: 30, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const { id } = await props.params;
  try {
    const ad = closeAd(auth.account.user.id, id);
    return NextResponse.json({ ok: true, ad: publicAd(ad) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 404 });
  }
}
