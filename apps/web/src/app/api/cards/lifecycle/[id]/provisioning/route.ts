import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { setProvisioning, lifecycleView } from "@/lib/services/cardLifecycle";

export const dynamic = "force-dynamic";

const Provision = z.object({
  wallet: z.enum(["googlePay", "applePay"]),
  enabled: z.boolean(),
});

// PATCH /api/cards/lifecycle/:id/provisioning — record that a card was pushed
// to, or pulled from, a device wallet.
//
// Only an ACTIVE card can be added: an un-activated or dead card sitting in
// Apple Pay is a decline waiting to happen, and a confusing one — the customer
// sees the card in their wallet and has no idea why the terminal says no.
// Removing is always allowed, so a customer can always clean up.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "cards.provisioning", { limit: 20, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, Provision);
  if (body instanceof NextResponse) return body;

  const { id } = await props.params;
  try {
    const lc = setProvisioning(id, account.user.id, body.wallet, body.enabled);
    return NextResponse.json({ ok: true, lifecycle: lifecycleView(lc) });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
  }
}
