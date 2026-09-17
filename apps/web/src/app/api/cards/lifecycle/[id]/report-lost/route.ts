import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { reportLost, lifecycleView } from "@/lib/services/cardLifecycle";
import { recordSecurityEvent } from "@/lib/ops/events";
import { cardIssuingLive, cardSimulationAllowed, getCardIssuer } from "@/lib/cardIssuer";

export const dynamic = "force-dynamic";

// POST /api/cards/lifecycle/:id/report-lost — report a card lost or stolen.
//
// TERMINAL AND IRREVERSIBLE. There is no un-report route, by design: a control
// an attacker can undo after taking over the session is not a control. The card
// is frozen, its PIN is destroyed and its wallet provisioning is revoked; the
// only way back is a reissue, which mints a new number.
//
// No body — the customer is asserting one fact, and there is nothing to
// parameterise.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "cards.report_lost", { limit: 10, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const { id } = await props.params;
  try {
    const lc = reportLost(id, account.user.id);
    const card = account.cards.find((c) => c.id === id);
    if (card) {
      card.frozen = true;
      // Freezing alone leaves the channels enabled for whenever it thaws; a
      // lost card never thaws, so close them too.
      card.channels = { online: false, offline: false, atm: false };
    }

    // Tell the issuer. Local state is already protective, so this is attempted
    // AFTER it rather than before — a failure here must not leave a lost card
    // looking usable in the app.
    //
    // But it must also not be swallowed. A lost card the issuer never froze is
    // still live in someone else's hands, so when this fails the response says
    // so instead of a bare ok:true. Claiming a stopped card that is not stopped
    // is the worst thing this endpoint could do.
    let stoppedAtIssuer = false;
    if (card?.providerCardRef && (cardIssuingLive() || cardSimulationAllowed())) {
      try {
        await getCardIssuer().setCardStatus(card.providerCardRef, "closed");
        stoppedAtIssuer = true;
      } catch {
        await recordSecurityEvent({
          kind: "card_stop_failed_at_issuer",
          rail: "transfers",
          severity: "critical",
          detail: `Card …${card.last4} reported lost but the issuer did not confirm the stop`,
          actor: account.user.id,
        }).catch(() => {});
      }
    }

    await recordSecurityEvent({
      kind: "card_reported_lost",
      rail: "transfers",
      severity: "high",
      detail: `Card …${card?.last4 ?? "????"} reported lost or stolen`,
      actor: account.user.id,
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      stoppedAtIssuer,
      ...(card?.providerCardRef && !stoppedAtIssuer
        ? {
            warning:
              "The card is blocked in FurlPay, but the issuer did not confirm it was stopped. Contact support so it can be stopped on the network.",
          }
        : {}),
      lifecycle: lifecycleView(lc),
    });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
  }
}
