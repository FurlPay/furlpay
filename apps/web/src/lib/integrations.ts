import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Central live/mock integration guard.
//
// The repo's convention: every third-party seam runs in MOCK mode with zero
// credentials, and swaps to LIVE with INTEGRATION_MODE=live + credentials.
// Mock is perfect for dev and previews — and an incident in production:
// a mock settlement fabricates a tx hash, a mock signature check passes any
// well-formed blob. This guard makes "production + mock" fail closed in ONE
// place instead of a per-route copy that someone eventually forgets.
// ---------------------------------------------------------------------------

export class IntegrationNotConfiguredError extends Error {
  readonly feature: string;
  constructor(feature: string) {
    super(`${feature} is not configured for production. Set INTEGRATION_MODE=live and the required credentials.`);
    this.feature = feature;
  }
}

export function integrationMode(): "live" | "mock" {
  return process.env.INTEGRATION_MODE === "live" ? "live" : "mock";
}

export function isLive(): boolean {
  return integrationMode() === "live";
}

/**
 * True when an integration seam may PROCEED: either mock behavior is
 * acceptable (any non-production environment) or the deployment is genuinely
 * live (INTEGRATION_MODE=live — real credentials, real settlement). The one
 * state that fails is "production without live config".
 *
 * NOTE the name is narrower than the contract: in production+live this
 * returns true because the LIVE path runs, not because mocks are welcome.
 * Seams whose only implementation is a mock must therefore ALSO hard-stop on
 * NODE_ENV=production (see services/payments.ts settle() and the wallets
 * transfer route) — INTEGRATION_MODE=live cannot make an unimplemented
 * integration real, and must never let one fabricate settlement.
 */
export function mockAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || isLive();
}

/** Throw unless `feature` can run for real. Call at the top of every
 *  money-moving code path (settle, refund, transfer, credit). */
export function requireLive(feature: string): void {
  if (!mockAllowed()) throw new IntegrationNotConfiguredError(feature);
}

/** Route-friendly variant: a 503 response when the feature is unavailable,
 *  null when it may proceed. */
export function liveOr503(feature: string): NextResponse | null {
  if (mockAllowed()) return null;
  return NextResponse.json(
    { error: "service_unavailable", detail: `${feature} is not configured on this deployment.` },
    { status: 503 }
  );
}
