import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { mintRevealGrant, CARD_LIMITS } from "@/lib/services/cardLifecycle";
import { recordSecurityEvent } from "@/lib/ops/events";
import { cardIssuerOr503 } from "@/lib/cardIssuer";

export const dynamic = "force-dynamic";

// POST /api/cards/lifecycle/:id/reveal — get a permit to show the card number.
//
// FurlPay never holds the PAN or CVV. This mints a single-use, 60-second grant
// bound to one card and one user; the client exchanges it directly with the PCI
// vault, which is what actually returns the digits. That keeps card data
// entirely outside our scope — there is nothing here to leak.
//
// POST rather than GET for a read, deliberately: it mints a credential, it is
// not idempotent, and it must never end up in a browser history or a proxy log.
//
// Tight budget: each call is a fresh opportunity to display a card number, so
// a compromised session should not be able to farm them.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  // No issuer is contracted: this route cannot produce a real card
  // credential or authorization. See lib/cardIssuer.ts.
  const unavailable = cardIssuerOr503("Revealing card details");
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "cards.reveal", { limit: 5, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const { id } = await props.params;
  try {
    const grant = mintRevealGrant(id, account.user.id);

    // Someone reading their card number is worth a record — it is the action a
    // takeover performs before the card is used elsewhere.
    await recordSecurityEvent({
      kind: "card_details_revealed",
      rail: "transfers",
      severity: "low",
      detail: `Reveal grant issued for card ${id}`,
      actor: account.user.id,
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      // The vault exchange is what returns the PAN; this route returns only the
      // permit to ask for it.
      grantToken: grant.token,
      expiresAt: grant.expiresAt,
      ttlSeconds: CARD_LIMITS.revealGrantTtlSeconds,
    });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
  }
}
