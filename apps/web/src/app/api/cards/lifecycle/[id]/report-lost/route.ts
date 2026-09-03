import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { reportLost, lifecycleView } from "@/lib/services/cardLifecycle";
import { recordSecurityEvent } from "@/lib/ops/events";

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

    await recordSecurityEvent({
      kind: "card_reported_lost",
      rail: "transfers",
      severity: "high",
      detail: `Card …${card?.last4 ?? "????"} reported lost or stolen`,
      actor: account.user.id,
    }).catch(() => {});

    return NextResponse.json({ ok: true, lifecycle: lifecycleView(lc) });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
  }
}
