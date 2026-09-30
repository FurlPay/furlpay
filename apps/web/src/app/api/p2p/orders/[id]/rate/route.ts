import { NextRequest, NextResponse } from "next/server";
import { p2pUnavailable } from "@/lib/services/p2pSettlement";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { rateCounterparty } from "@/lib/services/p2p";
import { orderView } from "@/lib/services/p2pView";

export const dynamic = "force-dynamic";

const Rate = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(300).optional(),
});

// POST /api/p2p/orders/:id/rate — rate the counterparty after a completed
// trade. One rating per side per order: the service refuses a second, so a
// maker cannot farm their own badge by re-rating.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const unavailable = p2pUnavailable();
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "p2p.orders.rate", { limit: 20, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const body = await validateBody(req, Rate);
  if (body instanceof NextResponse) return body;

  const { id } = await props.params;
  try {
    const order = rateCounterparty(id, userId, body.stars, body.comment ?? "");
    return NextResponse.json({ ok: true, order: orderView(order, userId) });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
  }
}
