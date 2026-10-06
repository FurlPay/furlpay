import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { validateBody } from "@/lib/validate";
import { recordSecurityEvent } from "@/lib/ops/events";
import { cardIssuingLive, cardSimulationAllowed, getCardIssuer } from "@/lib/cardIssuer";
import { isWatchFreezeOnly } from "@/lib/watchScope";

// POST /api/cards/settings — real-time card controls (Marqeta-style).
// body: { cardId, freeze?, limits?: { daily?, perPurchase? }, channels?, priority?, settlementCurrency? }
//
// Every state change here is a support-adjacent account mutation, so each one
// writes to the ops:security feed — the audit trail must not depend on which
// surface (app, web, co-pilot) triggered it.

const STABLES = ["USDC", "USDT", "EURC", "PYUSD", "DAI"] as const;

const Body = z.object({
  cardId: z.string().min(1).max(64),
  freeze: z.boolean().optional(),
  limits: z
    .object({
      daily: z.number().positive().max(1_000_000).optional(),
      perPurchase: z.number().positive().max(1_000_000).optional(),
    })
    .optional(),
  channels: z
    .object({
      online: z.boolean().optional(),
      offline: z.boolean().optional(),
      atm: z.boolean().optional(),
    })
    .optional(),
  priority: z.array(z.enum(STABLES)).max(STABLES.length).optional(),
  settlementCurrency: z.enum(["USD", "EUR", "GBP", "INR"]).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;

  // A watch token may only FREEZE (SEC-P2-004). Unfreezing re-enables spending
  // and needs the phone's biometric; limits and channels likewise stay there.
  if (auth.claims.watch === true && !isWatchFreezeOnly(body)) {
    return NextResponse.json({ error: "Only freezing a card is available from the watch. Use your phone." }, { status: 403 });
  }

  const account = auth.account;
  const card = account.cards.find((c) => c.id === body.cardId);
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  const changes: string[] = [];
  if (typeof body.freeze === "boolean" && body.freeze !== card.frozen) {
    // Tell the ISSUER first, then record it locally.
    //
    // The order is the whole point. This route used to flip `card.frozen` and
    // return 200, which showed the customer a frozen card while the issuer went
    // on authorising it — the single worst outcome for a control whose entire
    // purpose is to stop spend. If the issuer refuses, this request fails and
    // the local state is left alone, so the UI and the network never disagree.
    if (card.providerCardRef && (cardIssuingLive() || cardSimulationAllowed())) {
      try {
        await getCardIssuer().setCardStatus(card.providerCardRef, body.freeze ? "frozen" : "active");
      } catch {
        await recordSecurityEvent({
          // No "cards" rail exists in ops/controls.ts; this file already files its
          // other card event under "transfers". Matching that rather than
          // widening the Rail union, which would add a pausable rail that
          // nothing actually pauses.
          rail: "transfers",
          kind: "card_status_sync_failed",
          severity: "high",
          detail: `issuer refused ${body.freeze ? "freeze" : "unfreeze"} for ${card.id}`,
          actor: account.user.id,
        });
        return NextResponse.json(
          {
            error: "issuer_unavailable",
            detail: `The card could not be ${body.freeze ? "frozen" : "unfrozen"} at the issuer, so nothing was changed. Try again.`,
          },
          { status: 502 }
        );
      }
    }
    card.frozen = body.freeze;
    changes.push(body.freeze ? "frozen" : "unfrozen");
  }
  if (body.limits) {
    // Whitelisted keys only — never spread raw client JSON into stored state.
    if (body.limits.daily !== undefined) card.limits.daily = body.limits.daily;
    if (body.limits.perPurchase !== undefined) card.limits.perPurchase = body.limits.perPurchase;
    changes.push(`limits(daily=${card.limits.daily}, perPurchase=${card.limits.perPurchase})`);
  }
  if (body.channels) {
    if (body.channels.online !== undefined) card.channels.online = body.channels.online;
    if (body.channels.offline !== undefined) card.channels.offline = body.channels.offline;
    if (body.channels.atm !== undefined) card.channels.atm = body.channels.atm;
    changes.push("channels");
  }
  if (body.settlementCurrency) {
    card.settlementCurrency = body.settlementCurrency;
    changes.push(`settlement=${body.settlementCurrency}`);
  }
  // `priority` = asset spend order (which stablecoin to liquidate first).
  if (body.priority) {
    (card as { assetPriority?: string[] }).assetPriority = body.priority;
    changes.push("assetPriority");
  }

  if (changes.length) {
    await recordSecurityEvent({
      kind: card.frozen && changes.includes("frozen") ? "card_frozen" : "card_settings_changed",
      rail: "transfers",
      severity: changes.includes("unfrozen") ? "low" : "info",
      detail: `Card …${card.last4}: ${changes.join(", ")}`,
      actor: account.user.id,
    }).catch(() => {});
  }

  return NextResponse.json({ success: true, card });
}
