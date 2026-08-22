// ---------------------------------------------------------------------------
// Money-feature flags.
//
// WHY THIS EXISTS SEPARATELY FROM lib/integrations.ts. That module answers
// "may this seam run at all" — a deployment-wide live/mock switch. It cannot
// answer the question that actually gates a launch: "is THIS financial
// capability turned on, for whom, and can I turn it off in ten seconds?"
//
// A single INTEGRATION_MODE=live is all-or-nothing. Flipping it to enable real
// brokerage orders also enables every other live seam in the process, which is
// the opposite of how a regulated capability should be rolled out. These flags
// are per-capability, default OFF, and each one carries its own kill switch.
//
// THE FOUR GATES, and all four must pass:
//
//   1. enabled      the flag is explicitly on for this deployment
//   2. environment  the flag is permitted in this environment
//   3. credentials  every credential the capability needs is actually present
//   4. kill switch  no operator has pulled the emergency stop
//
// Gate 3 is the one that matters most, and it is why this file knows about env
// var NAMES rather than just booleans. "Enabled but unconfigured" is the state
// that produces a fabricated success: the flag says go, the provider client has
// no key, and the fallback path invents a fill. Requiring the credentials to be
// present before the flag can report `on` makes that state unreachable.
//
// NOTHING HERE MAKES A CAPABILITY REAL. A flag turning on only means the code
// is permitted to attempt the real operation. Where the real operation is not
// implemented, the implementation must still fail closed — a flag cannot
// conjure an integration, and must never be read as evidence that one exists.
// ---------------------------------------------------------------------------

/**
 * The deployment's financial environment.
 *
 * DELIBERATELY NOT `NODE_ENV`. Next sets NODE_ENV=production for every built
 * deployment including preview branches, so a preview would read as production
 * and either fail closed on everything or — far worse — be treated as a place
 * where real money may move. `FURLPAY_ENV` is set explicitly per deployment and
 * defaults to the SAFEST value, not the most permissive.
 */
export type FinancialEnvironment = "development" | "staging" | "production";

export function financialEnvironment(): FinancialEnvironment {
  const raw = (process.env.FURLPAY_ENV ?? "").trim().toLowerCase();
  if (raw === "production" || raw === "staging" || raw === "development") return raw;
  // Unset. Infer conservatively: a real production build is production (so the
  // production guards apply), anything else is development.
  return process.env.NODE_ENV === "production" && process.env.VERCEL_ENV === "production"
    ? "production"
    : "development";
}

export const MONEY_FLAGS = [
  "BROKERAGE_LIVE",
  "TOKENIZED_STOCKS_LIVE",
  "ONCHAIN_SETTLEMENT_LIVE",
  "ONCHAIN_BALANCES_LIVE",
  "DEFI_COLLATERAL_LIVE",
  "AI_TRADING_LIVE",
  "CROSS_CHAIN_STOCKS_LIVE",
  "HARDWARE_WALLET_LIVE",
] as const;

export type MoneyFlag = (typeof MONEY_FLAGS)[number];

interface FlagSpec {
  /** Human sentence for the ops console and for error bodies. */
  description: string;
  /** Environments in which this flag may be enabled at all. */
  environments: FinancialEnvironment[];
  /** Env vars that MUST be present before the flag can report `on`. */
  requires: string[];
  /**
   * True when the capability's real implementation does not exist yet.
   *
   * Recorded per flag rather than in a comment because it is the difference
   * between "off because nobody enabled it" and "off because there is nothing
   * to enable", and an operator staring at a red dot in the console deserves to
   * know which. A flag marked here can never report `on`, whatever the env says.
   */
  unimplemented?: string;
}

/**
 * The registry.
 *
 * `requires` lists the credentials WITHOUT which the capability would run its
 * fallback path. Getting this list right is the whole safety property, so each
 * entry names the specific operation that would otherwise be faked.
 */
export const FLAG_SPECS: Record<MoneyFlag, FlagSpec> = {
  BROKERAGE_LIVE: {
    description: "Route equity and ETF orders to the live brokerage instead of the internal simulator.",
    environments: ["staging", "production"],
    // Without these the Alpaca client cannot authenticate, and the order path
    // would fall back to the internal ledger — which reports a fill that never
    // reached a market.
    requires: ["ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY"],
  },
  TOKENIZED_STOCKS_LIVE: {
    description: "Enable quoting and routing of tokenized equity tokens.",
    environments: ["staging", "production"],
    requires: ["FURLPAY_STOCK_TOKEN_REGISTRY_VERIFIED"],
  },
  ONCHAIN_SETTLEMENT_LIVE: {
    description: "Broadcast real on-chain settlement transactions.",
    environments: ["staging", "production"],
    requires: ["FURLPAY_KMS_PROVIDER", "ARBITRUM_RPC_URL"],
  },
  ONCHAIN_BALANCES_LIVE: {
    description: "Read wallet balances from chain RPCs rather than the internal ledger.",
    // Permitted in development: reading a public chain moves no money and is
    // the one capability a developer genuinely needs against real data.
    environments: ["development", "staging", "production"],
    requires: [],
  },
  DEFI_COLLATERAL_LIVE: {
    description: "Allow whitelisted assets to be posted as DeFi collateral.",
    environments: ["staging", "production"],
    requires: ["ARBITRUM_RPC_URL"],
    unimplemented:
      "The collateral risk engine (LTV, liquidation threshold, health factor) is not built. " +
      "Posting collateral without it cannot price liquidation risk.",
  },
  AI_TRADING_LIVE: {
    description: "Let an AI agent submit trades within an approved policy envelope.",
    environments: ["staging", "production"],
    requires: ["ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY"],
  },
  CROSS_CHAIN_STOCKS_LIVE: {
    description: "Bridge tokenized equity tokens between chains.",
    environments: ["staging", "production"],
    requires: ["FURLPAY_STOCK_TOKEN_REGISTRY_VERIFIED"],
    unimplemented:
      "Bridging a security token requires per-issuer transfer-restriction checks that are not " +
      "implemented. A bridge API accepting the chain is not evidence the token may legally move.",
  },
  HARDWARE_WALLET_LIVE: {
    description: "Sign transactions with an external hardware wallet.",
    environments: ["development", "staging", "production"],
    requires: [],
  },
};

/** Why a flag is off. `null` when it is on. */
export type FlagBlocker =
  | { reason: "disabled"; detail: string }
  | { reason: "environment"; detail: string }
  | { reason: "missing_credentials"; detail: string; missing: string[] }
  | { reason: "killed"; detail: string }
  | { reason: "unimplemented"; detail: string };

export interface FlagState {
  flag: MoneyFlag;
  on: boolean;
  blocker: FlagBlocker | null;
  environment: FinancialEnvironment;
  description: string;
}

function envTruthy(name: string): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

function present(name: string): boolean {
  return (process.env[name] ?? "").trim().length > 0;
}

/**
 * The global kill switch.
 *
 * One variable disables every money capability at once, and it is checked
 * FIRST so it cannot be defeated by a per-flag setting. This is the control an
 * operator reaches for during an incident, so it is deliberately blunt: it does
 * not need to know which capability is misbehaving.
 */
export function moneyKillSwitchEngaged(): boolean {
  return envTruthy("FURLPAY_MONEY_KILL_SWITCH");
}

/** Full evaluation of one flag, including WHY it is off. */
export function flagState(flag: MoneyFlag): FlagState {
  const spec = FLAG_SPECS[flag];
  const environment = financialEnvironment();
  const base = { flag, environment, description: spec.description };

  if (moneyKillSwitchEngaged()) {
    return {
      ...base,
      on: false,
      blocker: {
        reason: "killed",
        detail: "The global money kill switch (FURLPAY_MONEY_KILL_SWITCH) is engaged.",
      },
    };
  }

  // Checked before `enabled`: an operator must not be able to turn on a
  // capability that has no implementation by setting an env var.
  if (spec.unimplemented) {
    return { ...base, on: false, blocker: { reason: "unimplemented", detail: spec.unimplemented } };
  }

  if (!envTruthy(flag)) {
    return {
      ...base,
      on: false,
      blocker: { reason: "disabled", detail: `${flag} is not enabled on this deployment.` },
    };
  }

  if (!spec.environments.includes(environment)) {
    return {
      ...base,
      on: false,
      blocker: {
        reason: "environment",
        detail: `${flag} may not be enabled in the ${environment} environment.`,
      },
    };
  }

  const missing = spec.requires.filter((name) => !present(name));
  if (missing.length > 0) {
    return {
      ...base,
      on: false,
      blocker: {
        reason: "missing_credentials",
        // The NAMES are safe to report to an operator; the values never are.
        detail: `${flag} is enabled but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set.`,
        missing,
      },
    };
  }

  return { ...base, on: true, blocker: null };
}

/** Is this capability live? The single question most callers should ask. */
export function flagEnabled(flag: MoneyFlag): boolean {
  return flagState(flag).on;
}

/** Every flag's state, for the ops console and the readiness endpoint. */
export function allFlagStates(): FlagState[] {
  return MONEY_FLAGS.map(flagState);
}

/**
 * Thrown when a money path is reached with its capability off.
 *
 * A distinct error type rather than a generic one so the API layer can map it
 * to a 503 with an honest body — the caller learns the feature is not available
 * here, which is true, instead of receiving a fabricated success.
 */
export class FeatureDisabledError extends Error {
  readonly flag: MoneyFlag;
  readonly blocker: FlagBlocker;

  constructor(state: FlagState) {
    super(state.blocker?.detail ?? `${state.flag} is not available.`);
    this.name = "FeatureDisabledError";
    this.flag = state.flag;
    this.blocker = state.blocker ?? { reason: "disabled", detail: "unavailable" };
  }
}

/** Assert a capability is live, or throw. Call at the top of a money path. */
export function requireFlag(flag: MoneyFlag): void {
  const state = flagState(flag);
  if (!state.on) throw new FeatureDisabledError(state);
}

/**
 * May a simulated implementation stand in for this capability?
 *
 * Only outside production, and only while the real capability is off. Once a
 * flag is on, the simulator is unreachable even in development — otherwise a
 * developer testing the live path silently gets the fake one, which is exactly
 * the confusion that lets a mock reach production.
 */
export function simulationAllowed(flag: MoneyFlag): boolean {
  return financialEnvironment() !== "production" && !flagEnabled(flag);
}
