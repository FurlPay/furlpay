import { NextResponse } from "next/server";
import { flagEnabled, flagState, simulationAllowed, type MoneyFlag } from "@/lib/flags";

// ---------------------------------------------------------------------------
// Route gate for a money capability.
//
// cardIssuerOr503 (lib/cardIssuer.ts) is this same gate specialised to cards.
// It was written once, for one surface, and the routes that needed the same
// protection — credit, bill pay, rewards, payroll's demo roster, the travel
// virtual card — each either reinvented it with a NODE_ENV check or did not
// have it at all. This is the general form, so the next route has one call to
// make instead of a decision to get right.
//
// THREE OUTCOMES, and the third is the one that matters:
//
//   live        the flag is on          -> null, the route serves real data
//   simulated   dev/staging, flag off   -> null, the route MAY serve a fixture,
//                                          and must mark it with `simulated: true`
//   neither     production, flag off    -> 503 naming the capability and the
//                                          flag's own reason. Never a fixture.
//
// The body repeats the flag's blocker text. That text describes our own
// missing integration — never a credential value or a topology — so it is safe
// to return, and it lets a client (or an operator reading a log) show WHY
// rather than a bare "unavailable".
// ---------------------------------------------------------------------------

export type CapabilityMode = "live" | "simulated";

/** How this request may be served, or null when it may not be served at all. */
export function capabilityMode(flag: MoneyFlag): CapabilityMode | null {
  if (flagEnabled(flag)) return "live";
  if (simulationAllowed(flag)) return "simulated";
  return null;
}

export function capabilityUnavailable(flag: MoneyFlag, feature: string): NextResponse {
  const state = flagState(flag);
  return NextResponse.json(
    {
      error: "service_unavailable",
      capability: flag,
      detail: `${feature} is not available on this deployment.`,
      reason: state.blocker?.reason ?? "disabled",
      explanation: state.blocker?.detail,
    },
    { status: 503 }
  );
}

/** Null when the route may proceed (live or simulated); a 503 otherwise. */
export function capabilityOr503(flag: MoneyFlag, feature: string): NextResponse | null {
  return capabilityMode(flag) === null ? capabilityUnavailable(flag, feature) : null;
}
