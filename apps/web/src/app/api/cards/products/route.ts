import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { availableProducts, CARD_THEMES } from "@/lib/services/cardLifecycle";
import { getSubscription } from "@/lib/services/membership";

export const dynamic = "force-dynamic";

// GET /api/cards/products — what this account can order, and why it cannot
// order the rest.
//
// The refusal reasons come back with the list rather than only at order time,
// so the UI can show "Metal — requires Pro" instead of letting someone pick it
// and then rejecting them.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "cards.products", { limit: 60, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const tier = getSubscription(account.user.id).planId;
  return NextResponse.json({
    products: availableProducts(tier, account.user.kycStatus === "verified", account.cards.length),
    themes: CARD_THEMES.map((t) => ({ ...t, locked: t.premium && tier === "Standard" })),
  });
}
