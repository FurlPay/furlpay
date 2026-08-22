// ---------------------------------------------------------------------------
// Brokerage provider selection.
//
// One function decides which adapter the app talks to, and it is the ONLY
// place that decision is made. The alternative — every call site checking a
// flag and picking a client — is how a fallback to simulation ends up on a
// production code path: not through a decision anyone made, but through one
// call site that checked a slightly different condition.
//
// THE SELECTION RULE, in full:
//
//   BROKERAGE_LIVE on + credentials present  → Alpaca, live host
//   non-production, flag off                 → the simulator
//   production, flag off                      → NOTHING. Throws.
//
// The third case is the one worth stating out loud. In production with the
// capability off, there is no provider, and asking for one is a programming
// error rather than a condition to degrade around. Returning a simulator there
// would mean a real user receiving a fabricated fill, which is the single
// outcome this whole subsystem exists to make impossible.
// ---------------------------------------------------------------------------

import { FeatureDisabledError, financialEnvironment, flagState } from "@/lib/flags";
import { quoteFor } from "@/lib/markets/quotes";
import { AlpacaBrokerageProvider, alpacaConfigFromEnv } from "./alpaca";
import { SimulatedBrokerageProvider } from "./simulator";
import type { BrokerageProvider } from "./types";

export * from "./types";
export { AlpacaBrokerageProvider } from "./alpaca";
export { SimulatedBrokerageProvider, __resetSimulator } from "./simulator";

/** Market price for the simulator, from the app's real quote pipeline. */
async function realQuote(symbol: string): Promise<number | null> {
  const q = await quoteFor(symbol).catch(() => null);
  return q?.price ?? null;
}

/**
 * The brokerage this deployment should use.
 *
 * Not cached: the flag state is read per call so an operator pulling the kill
 * switch takes effect on the next request rather than on the next deploy. The
 * construction cost is a couple of string reads.
 */
export function getBrokerage(): BrokerageProvider {
  const state = flagState("BROKERAGE_LIVE");

  if (state.on) {
    const config = alpacaConfigFromEnv(true);
    if (!config) {
      // Should be unreachable — the flag's `requires` covers both credentials —
      // but a missing-credential path that silently degrades is exactly the bug
      // class this module exists to prevent, so it fails instead.
      throw new FeatureDisabledError({
        ...state,
        on: false,
        blocker: {
          reason: "missing_credentials",
          detail: "BROKERAGE_LIVE is on but the Alpaca credentials could not be read.",
          missing: ["ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY"],
        },
      });
    }
    return new AlpacaBrokerageProvider(config);
  }

  if (financialEnvironment() === "production") {
    throw new FeatureDisabledError(state);
  }

  // Non-production with the flag off. If paper credentials happen to be
  // present, prefer the paper host over the in-memory simulator: it exercises
  // the real adapter, the real wire format and the real error paths, which is
  // where integration bugs actually live.
  const paper = alpacaConfigFromEnv(false);
  if (paper) return new AlpacaBrokerageProvider(paper);

  return new SimulatedBrokerageProvider(realQuote);
}

/**
 * The brokerage, or null when the capability is off.
 *
 * For read paths that should degrade rather than fail — a portfolio screen can
 * render its other sections without brokerage positions, and an empty section
 * labelled unavailable beats a 503 for the whole page.
 */
export function getBrokerageOrNull(): BrokerageProvider | null {
  try {
    return getBrokerage();
  } catch {
    return null;
  }
}

/** Whether orders placed right now reach a real market. Read this before
 *  presenting any fill to a user as real. */
export function brokerageIsLive(): boolean {
  return flagState("BROKERAGE_LIVE").on;
}
