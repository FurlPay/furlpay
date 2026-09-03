import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { setTheme, lifecycleView } from "@/lib/services/cardLifecycle";
import { getSubscription } from "@/lib/services/membership";

export const dynamic = "force-dynamic";

const SetTheme = z.object({ themeId: z.string().trim().min(1).max(32) });

// PUT /api/cards/lifecycle/:id/theme — restyle a card.
//
// Premium designs are gated on the plan, and the gate is re-checked here rather
// than trusted from the products listing: a customer can downgrade between
// browsing and choosing.
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "cards.theme", { limit: 20, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, SetTheme);
  if (body instanceof NextResponse) return body;

  const { id } = await props.params;
  try {
    const lc = setTheme(id, account.user.id, body.themeId, getSubscription(account.user.id).planId);
    // The card's own gradient is what every surface renders, so it moves too.
    const card = account.cards.find((c) => c.id === id);
    if (card) card.gradient = lifecycleView(lc).theme.gradient;
    return NextResponse.json({ ok: true, lifecycle: lifecycleView(lc) });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
  }
}
