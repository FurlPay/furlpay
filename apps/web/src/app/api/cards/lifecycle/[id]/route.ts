import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getLifecycle, adoptExistingCard, lifecycleView, closeCard } from "@/lib/services/cardLifecycle";
import { recordSecurityEvent } from "@/lib/ops/events";
import { cardIssuingLive, cardSimulationAllowed, getCardIssuer } from "@/lib/cardIssuer";

export const dynamic = "force-dynamic";

// GET /api/cards/lifecycle/:id — where a card is in its life: ordered, in the
// post, active, closed. Cards that predate this module are adopted on first
// read so they report `active` rather than 404.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "cards.lifecycle.get", { limit: 60, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const { id } = await props.params;
  try {
    return NextResponse.json({ lifecycle: lifecycleView(getLifecycle(id, account.user.id)) });
  } catch {
    const card = account.cards.find((c) => c.id === id);
    if (!card) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ lifecycle: lifecycleView(adoptExistingCard(account.user.id, card)) });
  }
}

// DELETE /api/cards/lifecycle/:id — close a card the customer no longer wants.
//
// Distinct from reporting it lost: closing is an ordinary housekeeping action,
// losing it is a security assertion, and the two must stay distinguishable in
// the record. Both are irreversible; recovery is a reissue.
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "cards.lifecycle.close", { limit: 10, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const { id } = await props.params;
  try {
    const lc = closeCard(id, account.user.id);
    // A closed card must stop authorizing, not merely report as closed — which
    // is exactly what this did before the issuer seam existed.
    const card = account.cards.find((c) => c.id === id);
    if (card) card.frozen = true;

    let closedAtIssuer = false;
    if (card?.providerCardRef && (cardIssuingLive() || cardSimulationAllowed())) {
      try {
        await getCardIssuer().setCardStatus(card.providerCardRef, "closed");
        closedAtIssuer = true;
      } catch {
        await recordSecurityEvent({
          kind: "card_close_failed_at_issuer",
          rail: "transfers",
          severity: "high",
          detail: `Card …${card.last4} closed locally but the issuer did not confirm`,
          actor: account.user.id,
        }).catch(() => {});
      }
    }

    await recordSecurityEvent({
      kind: "card_closed",
      rail: "transfers",
      severity: "low",
      detail: `Card …${card?.last4 ?? "????"} closed by customer`,
      actor: account.user.id,
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      closedAtIssuer,
      ...(card?.providerCardRef && !closedAtIssuer
        ? { warning: "The card is closed in FurlPay, but the issuer did not confirm. Support has been notified." }
        : {}),
      lifecycle: lifecycleView(lc),
    });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
  }
}
