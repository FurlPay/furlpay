import { NextResponse } from "next/server";
import { flagEnabled, flagState, simulationAllowed } from "@/lib/flags";

// ---------------------------------------------------------------------------
// The card-issuing boundary.
//
// WHY THIS FILE EXISTS. The card surface is large — issue, order, activate,
// reissue, set a PIN, reveal the PAN, push to a device wallet, authorise a
// swipe — and every one of those routes was reachable in production while the
// implementation behind them was local state. `POST /api/cards` minted an
// object with a `crypto.randomInt` last-4 and `network: "Visa"` and returned
// `status: "active"`. Nothing was issued. Nobody was told.
//
// A per-route `if (production) 503` would work and would also be forgotten by
// the next card route, so the gate lives here and every card route calls it.
//
// WHAT GATES IT. `CARD_ISSUING_LIVE` in lib/flags.ts, which carries an
// `unimplemented` reason. That is the important detail: `unimplemented` is
// checked BEFORE `enabled` in flagState(), so setting FURLPAY_CARD_ISSUER and
// flipping the flag cannot turn this on. The flag becomes meaningful the day
// somebody deletes that reason, and on that day they must have an issuer.
//
// DEVELOPMENT STILL WORKS. `simulationAllowed()` permits the local card
// simulator outside production while the flag is off, so the card screens stay
// buildable. It returns false in production, and it returns false once the flag
// is on — a developer testing the real path never silently gets the fake one.
// ---------------------------------------------------------------------------

/** True when a contracted issuer can actually service this request. */
export function cardIssuingLive(): boolean {
  return flagEnabled("CARD_ISSUING_LIVE");
}

/** True when the local card simulator may stand in (never in production). */
export function cardSimulationAllowed(): boolean {
  return simulationAllowed("CARD_ISSUING_LIVE");
}

/**
 * Route guard for anything that issues a card, mints a card credential, or
 * authorises card spend.
 *
 * Returns a 503 when neither a live issuer nor the simulator is available —
 * which today is every production deployment — and `null` when the caller may
 * proceed. The body names the capability and repeats the flag's own reason, so
 * an operator reading a log sees why rather than a bare "unavailable".
 */
export function cardIssuerOr503(feature: string): NextResponse | null {
  if (cardIssuingLive() || cardSimulationAllowed()) return null;

  const state = flagState("CARD_ISSUING_LIVE");
  return NextResponse.json(
    {
      error: "service_unavailable",
      detail: `${feature} is not available on this deployment.`,
      reason: state.blocker?.reason ?? "disabled",
      // Safe to surface: it describes our own missing integration, not a
      // credential or a topology an attacker could use.
      explanation: state.blocker?.detail,
    },
    { status: 503 }
  );
}
