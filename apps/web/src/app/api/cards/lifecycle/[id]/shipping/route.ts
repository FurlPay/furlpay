import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { updateShipping, lifecycleView } from "@/lib/services/cardLifecycle";
import { ShippingAddressSchema } from "@/lib/cardSchemas";

export const dynamic = "force-dynamic";

// PUT /api/cards/lifecycle/:id/shipping — change where a card is being sent.
//
// Only while the card is still `ordered`. Once it is in the post, accepting a
// new address here would show the customer a destination the parcel is not
// going to — worse than refusing, because they would stop watching the old one.
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "cards.shipping", { limit: 10, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, ShippingAddressSchema);
  if (body instanceof NextResponse) return body;

  const { id } = await props.params;
  try {
    return NextResponse.json({ ok: true, lifecycle: lifecycleView(updateShipping(id, account.user.id, body)) });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
  }
}
