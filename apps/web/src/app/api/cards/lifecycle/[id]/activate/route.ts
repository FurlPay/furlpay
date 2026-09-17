import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { activateCard, lifecycleView } from "@/lib/services/cardLifecycle";
import { recordSecurityEvent } from "@/lib/ops/events";
import { cardIssuerOr503, getCardIssuer } from "@/lib/cardIssuer";

export const dynamic = "force-dynamic";

const Activate = z.object({
  // Digits as a string — a numeric type would eat the leading zeros that make
  // up a fifth of valid codes.
  code: z.string().regex(/^\d{8}$/, "Activation code must be 8 digits"),
});

// POST /api/cards/lifecycle/:id/activate — bring a delivered physical card into
// service by entering the code printed on its carrier.
//
// The code proves the customer physically holds the card, which is the whole
// defence against a card intercepted in the post. The service caps attempts;
// this route's budget is deliberately tight on top of that, because an 8-digit
// code with a fast endpoint in front of it is not a possession proof.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  // No issuer is contracted: this route cannot produce a real card
  // credential or authorization. See lib/cardIssuer.ts.
  const unavailable = cardIssuerOr503("Card activation");
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "cards.activate", { limit: 5, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, Activate);
  if (body instanceof NextResponse) return body;

  const { id } = await props.params;
  try {
    const lc = activateCard(id, account.user.id, body.code);
    // Activation is what lifts the freeze an un-activated card ships with.
    const card = account.cards.find((c) => c.id === id);

    // The issuer has to agree before we tell the customer the card works. The
    // failure direction matters here: reporting an inactive card as active
    // sends someone to a checkout with a card that will decline.
    if (card?.providerCardRef) {
      try {
        await getCardIssuer().setCardStatus(card.providerCardRef, "active");
      } catch {
        return NextResponse.json(
          {
            ok: false,
            error: "issuer_unavailable",
            detail: "The card could not be activated at the issuer. Nothing was changed; try again.",
          },
          { status: 502 }
        );
      }
    }
    if (card) card.frozen = false;

    await recordSecurityEvent({
      kind: "card_activated",
      rail: "transfers",
      severity: "info",
      detail: `Card …${card?.last4 ?? "????"} activated`,
      actor: account.user.id,
    }).catch(() => {});

    return NextResponse.json({ ok: true, lifecycle: lifecycleView(lc) });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("not found")) return NextResponse.json({ ok: false, error: msg }, { status: 404 });

    // A wrong code is worth an ops event: a run of them on one account is
    // someone working through a code they do not have.
    if (msg.includes("Incorrect")) {
      await recordSecurityEvent({
        kind: "card_activation_failed",
        rail: "transfers",
        severity: "medium",
        detail: `Failed activation attempt on card ${id}`,
        actor: account.user.id,
      }).catch(() => {});
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 409 });
  }
}
