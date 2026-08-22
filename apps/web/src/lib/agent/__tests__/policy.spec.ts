import { describe, it, expect } from "vitest";
import {
  DEFAULT_POLICY,
  evaluate,
  normalizePolicy,
  previewIsValid,
  type AgentAction,
  type PolicyContext,
  type TradingPolicy,
} from "../policy";

// ---------------------------------------------------------------------------
// The agent trading policy engine.
//
// The property under test everywhere: an agent cannot do more than the user
// agreed to in advance. Most of these tests are about DENIAL, because the
// engine's value is entirely in what it refuses — and because the realistic
// failure is not a rogue model but an arithmetic slip or an injected
// instruction producing a well-formed action nobody authorised.
// ---------------------------------------------------------------------------

const ENABLED: TradingPolicy = {
  tradingEnabled: true,
  maxTradeAmountUsd: 1000,
  maxDailyAmountUsd: 5000,
  allowedSymbols: ["NVDA", "AAPL"],
  blockedSymbols: [],
  requireApprovalAboveUsd: 500,
  requireBiometricAboveUsd: 900,
  maxOrdersPerDay: 10,
};

function ctx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    policy: ENABLED,
    dailySpentUsd: 0,
    dailyOrderCount: 0,
    capabilityEnabled: true,
    ...overrides,
  };
}

const buy = (symbol: string, notionalUsd: number): AgentAction => ({ kind: "buy", symbol, notionalUsd });

describe("default deny", () => {
  it("permits nothing but reads before a user configures a policy", () => {
    const c = ctx({ policy: DEFAULT_POLICY });
    expect(evaluate({ kind: "read" }, c).verdict).toBe("allow");

    const decision = evaluate(buy("NVDA", 1), c);
    expect(decision.verdict).toBe("deny");
    if (decision.verdict === "deny") expect(decision.code).toBe("trading_disabled");
  });

  it("has a default policy with every limit at zero", () => {
    expect(DEFAULT_POLICY.tradingEnabled).toBe(false);
    expect(DEFAULT_POLICY.maxTradeAmountUsd).toBe(0);
    expect(DEFAULT_POLICY.maxDailyAmountUsd).toBe(0);
    expect(DEFAULT_POLICY.allowedSymbols).toEqual([]);
    expect(DEFAULT_POLICY.maxOrdersPerDay).toBe(0);
  });

  it("denies when the deployment capability is off, whatever the user set", () => {
    const decision = evaluate(buy("NVDA", 10), ctx({ capabilityEnabled: false }));
    expect(decision.verdict).toBe("deny");
    if (decision.verdict === "deny") expect(decision.code).toBe("capability_off");
  });

  it("reports the most fundamental reason first", () => {
    // A user told "exceeds your daily limit" when trading is disabled entirely
    // would go and raise their daily limit.
    const c = ctx({ policy: { ...ENABLED, tradingEnabled: false }, dailySpentUsd: 99_999 });
    const decision = evaluate(buy("ZZZZ", 99_999), c);
    expect(decision.verdict).toBe("deny");
    if (decision.verdict === "deny") expect(decision.code).toBe("trading_disabled");
  });
});

describe("symbol control", () => {
  it("allows only listed symbols", () => {
    expect(evaluate(buy("NVDA", 100), ctx()).verdict).toBe("allow");
    const decision = evaluate(buy("TSLA", 100), ctx());
    expect(decision.verdict).toBe("deny");
    if (decision.verdict === "deny") expect(decision.code).toBe("symbol_not_allowed");
  });

  it("treats an EMPTY allow-list as none, never as all", () => {
    const c = ctx({ policy: { ...ENABLED, allowedSymbols: [] } });
    const decision = evaluate(buy("NVDA", 10), c);
    expect(decision.verdict).toBe("deny");
    if (decision.verdict === "deny") expect(decision.code).toBe("symbol_not_allowed");
  });

  it("lets the block-list win over the allow-list", () => {
    // A contradictory configuration resolves to the safer reading.
    const c = ctx({ policy: { ...ENABLED, blockedSymbols: ["NVDA"] } });
    const decision = evaluate(buy("NVDA", 10), c);
    expect(decision.verdict).toBe("deny");
    if (decision.verdict === "deny") expect(decision.code).toBe("symbol_blocked");
  });

  it("is case-insensitive", () => {
    expect(evaluate(buy("nvda", 100), ctx()).verdict).toBe("allow");
  });
});

describe("size limits", () => {
  it("denies above the per-trade limit", () => {
    const decision = evaluate(buy("NVDA", 1001), ctx());
    expect(decision.verdict).toBe("deny");
    if (decision.verdict === "deny") expect(decision.code).toBe("exceeds_trade_limit");
  });

  it("denies when the daily budget would be exceeded", () => {
    const decision = evaluate(buy("NVDA", 600), ctx({ dailySpentUsd: 4500 }));
    expect(decision.verdict).toBe("deny");
    if (decision.verdict === "deny") {
      expect(decision.code).toBe("exceeds_daily_limit");
      expect(decision.detail).toContain("500.00");
    }
  });

  it("counts SELLS against the daily budget too", () => {
    // An agent that can liquidate a portfolio without limit is exactly as
    // dangerous as one that can spend without limit.
    const sell: AgentAction = { kind: "sell", symbol: "NVDA", notionalUsd: 600 };
    const decision = evaluate(sell, ctx({ dailySpentUsd: 4500 }));
    expect(decision.verdict).toBe("deny");
    if (decision.verdict === "deny") expect(decision.code).toBe("exceeds_daily_limit");
  });

  it("bounds the number of orders, not just their size", () => {
    // Ten $1 trades are individually compliant and collectively ruinous in fees.
    const decision = evaluate(buy("NVDA", 1), ctx({ dailyOrderCount: 10 }));
    expect(decision.verdict).toBe("deny");
    if (decision.verdict === "deny") expect(decision.code).toBe("exceeds_order_count");
  });

  it("rejects a non-positive or non-finite amount", () => {
    for (const amount of [0, -100, NaN, Infinity]) {
      const decision = evaluate(buy("NVDA", amount), ctx());
      expect(decision.verdict, String(amount)).toBe("deny");
      if (decision.verdict === "deny") expect(decision.code).toBe("invalid_action");
    }
  });
});

describe("approval thresholds", () => {
  it("executes unattended below the approval threshold", () => {
    expect(evaluate(buy("NVDA", 100), ctx()).verdict).toBe("allow");
  });

  it("requires confirmation above it", () => {
    const decision = evaluate(buy("NVDA", 600), ctx());
    expect(decision.verdict).toBe("require_approval");
    if (decision.verdict === "require_approval") expect(decision.stepUp).toBe("confirm");
  });

  it("escalates to biometric above the higher threshold", () => {
    const decision = evaluate(buy("NVDA", 950), ctx());
    expect(decision.verdict).toBe("require_approval");
    if (decision.verdict === "require_approval") expect(decision.stepUp).toBe("biometric");
  });

  it("checks the size limit before asking for approval", () => {
    // Approving something that would be denied anyway wastes the user's
    // attention and teaches them to approve reflexively.
    const decision = evaluate(buy("NVDA", 5000), ctx());
    expect(decision.verdict).toBe("deny");
  });
});

describe("cancellation", () => {
  it("is always permitted when trading is on", () => {
    // A policy that blocks cancellation traps a user in a position.
    const decision = evaluate({ kind: "cancel", clientOrderId: "fp_abc" }, ctx());
    expect(decision.verdict).toBe("allow");
  });

  it("is still gated on trading being enabled at all", () => {
    const c = ctx({ policy: DEFAULT_POLICY });
    expect(evaluate({ kind: "cancel", clientOrderId: "fp_abc" }, c).verdict).toBe("deny");
  });
});

describe("normalizePolicy", () => {
  it("returns the safe default for null", () => {
    expect(normalizePolicy(null)).toEqual(DEFAULT_POLICY);
    expect(normalizePolicy(undefined)).toEqual(DEFAULT_POLICY);
  });

  it("clamps a hostile or corrupted stored policy to zero", () => {
    // `amount > NaN` is false, so an unvalidated NaN limit would pass EVERY
    // size check — an infinite limit written as a typo.
    const nasty = normalizePolicy({
      tradingEnabled: true,
      maxTradeAmountUsd: NaN,
      maxDailyAmountUsd: -5000,
      requireApprovalAboveUsd: Infinity,
      maxOrdersPerDay: -1,
    } as Partial<TradingPolicy>);

    expect(nasty.maxTradeAmountUsd).toBe(0);
    expect(nasty.maxDailyAmountUsd).toBe(0);
    expect(nasty.requireApprovalAboveUsd).toBe(0);
    expect(nasty.maxOrdersPerDay).toBe(0);
  });

  it("caps an absurdly large limit rather than honouring it", () => {
    const p = normalizePolicy({ tradingEnabled: true, maxTradeAmountUsd: 1e12 });
    expect(p.maxTradeAmountUsd).toBeLessThanOrEqual(1_000_000);
  });

  it("treats tradingEnabled as strictly boolean true", () => {
    // A truthy string must not enable trading.
    expect(normalizePolicy({ tradingEnabled: "yes" as unknown as boolean }).tradingEnabled).toBe(false);
    expect(normalizePolicy({ tradingEnabled: 1 as unknown as boolean }).tradingEnabled).toBe(false);
    expect(normalizePolicy({ tradingEnabled: true }).tradingEnabled).toBe(true);
  });

  it("drops entries that are not plausible tickers", () => {
    const p = normalizePolicy({
      allowedSymbols: ["NVDA", "", "  ", "<script>", "WAY_TOO_LONG_SYMBOL", 42 as unknown as string, "aapl"],
    });
    expect(p.allowedSymbols).toEqual(["NVDA", "AAPL"]);
  });

  it("bounds the size of a symbol list", () => {
    const many = Array.from({ length: 500 }, (_, i) => `SYM${i % 10}${i}`.slice(0, 10));
    expect(normalizePolicy({ allowedSymbols: many }).allowedSymbols.length).toBeLessThanOrEqual(100);
  });
});

describe("preview expiry", () => {
  const now = Date.parse("2026-08-22T12:00:00.000Z");
  const preview = (expiresAt: string) =>
    ({ expiresAt }) as unknown as Parameters<typeof previewIsValid>[0];

  it("accepts a preview that has not expired", () => {
    expect(previewIsValid(preview(new Date(now + 60_000).toISOString()), now)).toBe(true);
  });

  it("rejects an expired preview", () => {
    // Otherwise an approval is a blank cheque against a price that has moved.
    expect(previewIsValid(preview(new Date(now - 1000).toISOString()), now)).toBe(false);
  });
});
