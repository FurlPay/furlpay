import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { withIdempotency } from "@/lib/idempotency";
import { reissueCard, lifecycleView } from "@/lib/services/cardLifecycle";
import { ShippingAddressSchema, CardLabelSchema } from "@/lib/cardSchemas";
import { recordSecurityEvent } from "@/lib/ops/events";

export const dynamic = "force-dynamic";

const Reissue = z.object({
  label: CardLabelSchema,
  shipping: ShippingAddressSchema.optional(),
});

// POST /api/cards/lifecycle/:id/reissue — replace a card.
//
// This is the recovery path from a loss, and the only one. The replacement gets
// a new number and NO PIN: carrying either across would mean the compromised
// card's details still work, which is the entire reason the customer is here.
//
// The old card keeps its `lost` status rather than being relabelled "reissued"
// — that status is the security record of why it left service.
//
// Idempotent per user: reissuing charges a fee and mints a card.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "cards.reissue", { limit: 5, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, Reissue);
  if (body instanceof NextResponse) return body;

  const { id } = await props.params;
  const idempotencyKey = req.headers.get("Idempotency-Key");
  return withIdempotency(idempotencyKey, "cards.reissue", async () => {
    try {
      const result = reissueCard(id, account.user.id, body);

      // The superseded card must stop authorizing immediately.
      const old = account.cards.find((c) => c.id === id);
      if (old) {
        old.frozen = true;
        old.channels = { online: false, offline: false, atm: false };
      }
      account.cards.push(result.card);

      await recordSecurityEvent({
        kind: "card_reissued",
        rail: "transfers",
        severity: "medium",
        detail: `Card …${old?.last4 ?? "????"} replaced by …${result.card.last4}`,
        actor: account.user.id,
      }).catch(() => {});

      return NextResponse.json(
        {
          ok: true,
          card: result.card,
          lifecycle: lifecycleView(result.lifecycle),
          previous: lifecycleView(result.previous),
          feeUsd: result.feeUsd,
        },
        { status: 201 },
      );
    } catch (e) {
      const msg = (e as Error).message;
      return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
    }
  }, { principal: account.user.id });
}
