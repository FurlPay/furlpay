import { NextResponse } from "next/server";
import { flagEnabled, flagState, simulationAllowed } from "@/lib/flags";
import type { CardIssuerProviderAdapter } from "@/lib/providers/types";
import { rainAdapter } from "@/lib/cards/rainAdapter";
import { createSimulatedCardIssuerAdapter } from "@/lib/cards/simulatedAdapter";

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

// ---------------------------------------------------------------------------
// The issuer seam.
//
// Every card route resolves its issuer here, so there is exactly one place that
// decides whether a request is served by a real issuer, by the simulator, or by
// nobody. docs/MAINNET_READINESS.md §11 records the absence of this seam as the
// gap; `cardIssuerOr503` above is the gate, and this is the thing behind it.
//
// The ordering matters and is the same ordering as the gate: a LIVE issuer
// wins, the simulator is only reachable when `cardSimulationAllowed()` says so
// (never in production, and never once a live issuer is configured), and
// otherwise this throws rather than returning something that fabricates.
//
// Note what is deliberately NOT here: no `if (provider === "rain")` scattered
// through the routes. That is the failure mode providers/types.ts exists to
// avoid — at that point changing issuer is a rewrite and losing one is an
// outage.
// ---------------------------------------------------------------------------

export class NoCardIssuerError extends Error {
  constructor() {
    super(
      "No card issuer is available on this deployment. Routes must call cardIssuerOr503() " +
        "before reaching this — if you are seeing this, a route skipped the gate."
    );
    this.name = "NoCardIssuerError";
  }
}

/**
 * The issuer for this deployment.
 *
 * Throws `NoCardIssuerError` when neither a live issuer nor the simulator is
 * available. Callers should have returned `cardIssuerOr503()` already; this
 * throw is the backstop for a route that forgot, and it is a throw rather than
 * a silent fallback precisely because a card route that quietly serves fixtures
 * is the thing this whole boundary exists to prevent.
 */
export function getCardIssuer(): CardIssuerProviderAdapter {
  if (cardIssuingLive()) {
    // The only live issuer today. `rainAdapter()` returns null without
    // credentials, so a flag flipped on without them fails loudly here rather
    // than serving a simulator in production.
    const rain = rainAdapter();
    if (rain) return rain;
    throw new NoCardIssuerError();
  }

  if (cardSimulationAllowed()) return createSimulatedCardIssuerAdapter();

  throw new NoCardIssuerError();
}
