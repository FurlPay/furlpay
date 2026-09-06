import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { withIdempotency } from "@/lib/idempotency";
import { recordSecurityEvent } from "@/lib/ops/events";
import { orderCard, lifecycleView } from "@/lib/services/cardLifecycle";
import { getSubscription } from "@/lib/services/membership";
import { ShippingAddressSchema, CardLabelSchema } from "@/lib/cardSchemas";
import { cardIssuerOr503 } from "@/lib/cardIssuer";

export const dynamic = "force-dynamic";

const Order = z.object({
  productId: z.string().trim().min(1).max(64),
  label: CardLabelSchema,
  themeId: z.string().trim().min(1).max(32).optional(),
  shipping: ShippingAddressSchema.optional(),
});

// POST /api/cards/order — order a virtual or physical card.
//
// A virtual card is live immediately; a physical one is created frozen and
// stays that way until the customer proves possession by entering the code on
// its carrier. Issuing it unfrozen would mean a card intercepted in the post
// works out of the envelope.
//
// Idempotent per user: ordering charges an issuance fee, so a retry after a
// timeout must not produce two cards.
export async function POST(req: NextRequest) {
  // No issuer is contracted: this route cannot produce a real card
  // credential or authorization. See lib/cardIssuer.ts.
  const unavailable = cardIssuerOr503("Card ordering");
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "cards.order", { limit: 5, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, Order);
  if (body instanceof NextResponse) return body;

  const idempotencyKey = req.headers.get("Idempotency-Key");
  return withIdempotency(idempotencyKey, "cards.order", async () => {
    try {
      const result = orderCard(account.user.id, body, {
        tier: getSubscription(account.user.id).planId,
        kycVerified: account.user.kycStatus === "verified",
        existingCards: account.cards.length,
      });

      account.cards.push(result.card);

      await recordSecurityEvent({
        kind: "card_ordered",
        rail: "transfers",
        severity: "info",
        detail: `Ordered ${result.lifecycle.productId} · card …${result.card.last4}`,
        actor: account.user.id,
      }).catch(() => {});

      return NextResponse.json(
        {
          ok: true,
          card: result.card,
          lifecycle: lifecycleView(result.lifecycle),
          feeUsd: result.feeUsd,
        },
        { status: 201 },
      );
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 409 });
    }
  }, { principal: account.user.id });
}
