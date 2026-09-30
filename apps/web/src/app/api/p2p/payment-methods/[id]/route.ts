import { NextRequest, NextResponse } from "next/server";
import { p2pUnavailable } from "@/lib/services/p2pSettlement";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { deletePaymentMethod } from "@/lib/services/p2p";

export const dynamic = "force-dynamic";

// DELETE /api/p2p/payment-methods/:id — remove a rail. Refused while a live
// order still points at it: that row is the buyer's only instruction for where
// to send the money.
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const unavailable = p2pUnavailable();
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "p2p.methods.delete", { limit: 20, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const { id } = await props.params;
  try {
    deletePaymentMethod(auth.account.user.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
  }
}
