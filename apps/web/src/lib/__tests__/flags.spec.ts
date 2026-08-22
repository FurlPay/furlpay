import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  allFlagStates,
  financialEnvironment,
  flagEnabled,
  flagState,
  requireFlag,
  simulationAllowed,
  FeatureDisabledError,
  MONEY_FLAGS,
  FLAG_SPECS,
} from "../flags";

// ---------------------------------------------------------------------------
// Money-feature flags.
//
// The property under test throughout: a flag can only report `on` when the
// capability behind it can actually be performed for real. Every test here is
// a different way of being "enabled but unable", because that is the state
// that produces a fabricated success — the flag says go, the client has no
// credentials, and something downstream invents a result.
// ---------------------------------------------------------------------------

const TOUCHED = [
  "FURLPAY_ENV",
  "NODE_ENV",
  "VERCEL_ENV",
  "FURLPAY_MONEY_KILL_SWITCH",
  "ALPACA_API_KEY_ID",
  "ALPACA_API_SECRET_KEY",
  "ARBITRUM_RPC_URL",
  "FURLPAY_KMS_PROVIDER",
  "FURLPAY_STOCK_TOKEN_REGISTRY_VERIFIED",
  ...MONEY_FLAGS,
];

const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of TOUCHED) {
    original[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of TOUCHED) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("financialEnvironment", () => {
  it("reads an explicit FURLPAY_ENV", () => {
    process.env.FURLPAY_ENV = "staging";
    expect(financialEnvironment()).toBe("staging");
    process.env.FURLPAY_ENV = "PRODUCTION";
    expect(financialEnvironment()).toBe("production");
  });

  it("does NOT treat a preview deployment as production", () => {
    // Next sets NODE_ENV=production for every built deployment, previews
    // included. Inferring production from it alone would mark a preview branch
    // as a place where real money may move.
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "preview";
    expect(financialEnvironment()).toBe("development");
  });

  it("infers production only for a real production deployment", () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    expect(financialEnvironment()).toBe("production");
  });

  it("defaults to the safest value when nothing is set", () => {
    expect(financialEnvironment()).toBe("development");
  });

  it("ignores an unrecognised value rather than trusting it", () => {
    process.env.FURLPAY_ENV = "prod";
    expect(financialEnvironment()).toBe("development");
  });
});

describe("flag gating", () => {
  it("defaults every money flag to off", () => {
    process.env.FURLPAY_ENV = "production";
    for (const flag of MONEY_FLAGS) {
      expect(flagEnabled(flag), `${flag} must default off`).toBe(false);
    }
  });

  it("turns on only with the flag AND every credential it names", () => {
    process.env.FURLPAY_ENV = "production";
    process.env.BROKERAGE_LIVE = "1";

    // Enabled but unconfigured — the dangerous state.
    let state = flagState("BROKERAGE_LIVE");
    expect(state.on).toBe(false);
    expect(state.blocker?.reason).toBe("missing_credentials");

    // One of two credentials is still not enough.
    process.env.ALPACA_API_KEY_ID = "key";
    state = flagState("BROKERAGE_LIVE");
    expect(state.on).toBe(false);
    expect(state.blocker).toMatchObject({ reason: "missing_credentials", missing: ["ALPACA_API_SECRET_KEY"] });

    process.env.ALPACA_API_SECRET_KEY = "secret";
    expect(flagState("BROKERAGE_LIVE").on).toBe(true);
  });

  it("reports WHICH credentials are missing, by name", () => {
    process.env.FURLPAY_ENV = "production";
    process.env.BROKERAGE_LIVE = "true";
    const state = flagState("BROKERAGE_LIVE");
    expect(state.blocker).toMatchObject({
      reason: "missing_credentials",
      missing: ["ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY"],
    });
  });

  it("never leaks a credential VALUE into a blocker an operator can read", () => {
    // Variable NAMES are safe to report and necessarily contain words like
    // "SECRET"; the values never are. This asserts the property that actually
    // matters, since the whole flag state is rendered in the ops console.
    process.env.FURLPAY_ENV = "production";
    process.env.BROKERAGE_LIVE = "1";
    process.env.ALPACA_API_KEY_ID = "AKIAVALUE_SHOULD_NOT_APPEAR";
    // One credential still missing, so the state carries a blocker to inspect.
    const serialized = JSON.stringify(flagState("BROKERAGE_LIVE"));
    expect(serialized).not.toContain("AKIAVALUE_SHOULD_NOT_APPEAR");
  });

  it("treats an empty-string credential as absent", () => {
    process.env.FURLPAY_ENV = "production";
    process.env.BROKERAGE_LIVE = "1";
    process.env.ALPACA_API_KEY_ID = "   ";
    process.env.ALPACA_API_SECRET_KEY = "";
    expect(flagState("BROKERAGE_LIVE").on).toBe(false);
  });

  it("refuses a flag in an environment it is not permitted in", () => {
    process.env.FURLPAY_ENV = "development";
    process.env.BROKERAGE_LIVE = "1";
    process.env.ALPACA_API_KEY_ID = "key";
    process.env.ALPACA_API_SECRET_KEY = "secret";
    const state = flagState("BROKERAGE_LIVE");
    expect(state.on).toBe(false);
    expect(state.blocker?.reason).toBe("environment");
  });

  it("accepts the usual truthy spellings and nothing else", () => {
    process.env.FURLPAY_ENV = "production";
    process.env.ALPACA_API_KEY_ID = "key";
    process.env.ALPACA_API_SECRET_KEY = "secret";

    for (const truthy of ["1", "true", "TRUE", "on", "yes"]) {
      process.env.BROKERAGE_LIVE = truthy;
      expect(flagEnabled("BROKERAGE_LIVE"), truthy).toBe(true);
    }
    for (const falsy of ["0", "false", "off", "no", "", "maybe"]) {
      process.env.BROKERAGE_LIVE = falsy;
      expect(flagEnabled("BROKERAGE_LIVE"), falsy).toBe(false);
    }
  });
});

describe("kill switch", () => {
  it("overrides every flag at once", () => {
    process.env.FURLPAY_ENV = "production";
    process.env.BROKERAGE_LIVE = "1";
    process.env.ALPACA_API_KEY_ID = "key";
    process.env.ALPACA_API_SECRET_KEY = "secret";
    expect(flagEnabled("BROKERAGE_LIVE")).toBe(true);

    process.env.FURLPAY_MONEY_KILL_SWITCH = "1";
    for (const flag of MONEY_FLAGS) {
      const state = flagState(flag);
      expect(state.on, flag).toBe(false);
      expect(state.blocker?.reason).toBe("killed");
    }
  });

  it("is checked before anything else, so no per-flag setting can defeat it", () => {
    process.env.FURLPAY_MONEY_KILL_SWITCH = "true";
    process.env.FURLPAY_ENV = "production";
    process.env.ONCHAIN_BALANCES_LIVE = "1";
    expect(flagState("ONCHAIN_BALANCES_LIVE").blocker?.reason).toBe("killed");
  });
});

describe("unimplemented capabilities", () => {
  it("cannot be switched on by an environment variable", () => {
    // The registry marks these as having no real implementation. An operator
    // must not be able to enable a capability that does not exist.
    const unimplemented = MONEY_FLAGS.filter((f) => FLAG_SPECS[f].unimplemented);
    expect(unimplemented.length).toBeGreaterThan(0);

    process.env.FURLPAY_ENV = "production";
    process.env.ARBITRUM_RPC_URL = "https://rpc.example";
    process.env.FURLPAY_STOCK_TOKEN_REGISTRY_VERIFIED = "1";
    for (const flag of unimplemented) {
      process.env[flag] = "1";
      const state = flagState(flag);
      expect(state.on, flag).toBe(false);
      expect(state.blocker?.reason).toBe("unimplemented");
    }
  });
});

describe("requireFlag", () => {
  it("throws a typed error carrying the reason", () => {
    process.env.FURLPAY_ENV = "production";
    try {
      requireFlag("BROKERAGE_LIVE");
      expect.unreachable("requireFlag should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FeatureDisabledError);
      expect((e as FeatureDisabledError).flag).toBe("BROKERAGE_LIVE");
      expect((e as FeatureDisabledError).blocker.reason).toBe("disabled");
    }
  });

  it("passes when the capability is genuinely live", () => {
    process.env.FURLPAY_ENV = "production";
    process.env.BROKERAGE_LIVE = "1";
    process.env.ALPACA_API_KEY_ID = "key";
    process.env.ALPACA_API_SECRET_KEY = "secret";
    expect(() => requireFlag("BROKERAGE_LIVE")).not.toThrow();
  });
});

describe("simulationAllowed", () => {
  it("is never allowed in production", () => {
    process.env.FURLPAY_ENV = "production";
    for (const flag of MONEY_FLAGS) {
      expect(simulationAllowed(flag), flag).toBe(false);
    }
  });

  it("is allowed in development while the real capability is off", () => {
    process.env.FURLPAY_ENV = "development";
    expect(simulationAllowed("BROKERAGE_LIVE")).toBe(true);
  });

  it("stops once the real capability is on, even in development", () => {
    // Otherwise a developer testing the live path silently gets the fake one —
    // the confusion that lets a mock reach production.
    process.env.FURLPAY_ENV = "staging";
    process.env.BROKERAGE_LIVE = "1";
    process.env.ALPACA_API_KEY_ID = "key";
    process.env.ALPACA_API_SECRET_KEY = "secret";
    expect(simulationAllowed("BROKERAGE_LIVE")).toBe(false);
  });
});

describe("registry hygiene", () => {
  it("gives every flag a description and at least one permitted environment", () => {
    for (const flag of MONEY_FLAGS) {
      const spec = FLAG_SPECS[flag];
      expect(spec.description.length, flag).toBeGreaterThan(10);
      expect(spec.environments.length, flag).toBeGreaterThan(0);
    }
  });

  it("permits no settlement-capable flag in development", () => {
    // Reads are fine in development; anything that can move money is not.
    const settlement = ["BROKERAGE_LIVE", "ONCHAIN_SETTLEMENT_LIVE", "AI_TRADING_LIVE"] as const;
    for (const flag of settlement) {
      expect(FLAG_SPECS[flag].environments, flag).not.toContain("development");
    }
  });

  it("reports every flag's state for the ops console", () => {
    const states = allFlagStates();
    expect(states).toHaveLength(MONEY_FLAGS.length);
    for (const s of states) {
      expect(s.on ? s.blocker : s.blocker?.detail).toBeTruthy();
    }
  });
});
