import {
  AGENT_SPEND_CATEGORIES,
  explainDenial,
  isExpired,
  isReadOnly,
  isUsable,
  previewAgentSpend,
  requiresHumanApproval,
  validatePolicy,
  type AgentKeyPublic,
  type DenyReason,
} from "../policy";

const NOW = Date.parse("2026-09-05T12:00:00Z");

function key(over: Partial<AgentKeyPublic> = {}): AgentKeyPublic {
  return {
    keyId: "agent_abc",
    name: "Travel Agent",
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    policy: {
      perTxLimitUsd: 300,
      dailyBudgetUsd: 1000,
      allowedCategories: ["travel", "commerce"],
    },
    ...over,
  };
}

describe("the client never authorizes", () => {
  it("returns wouldAllow, not allowed — the field name is the contract", () => {
    const d = previewAgentSpend({ key: key(), amountUsd: 50, category: "travel", now: NOW });
    expect(d).toHaveProperty("wouldAllow");
    expect(d).not.toHaveProperty("allowed");
  });

  it("defers to the server whenever the local checks pass", () => {
    // The daily budget is a cross-instance atomic counter. A client that
    // answered it would be guessing, and the guess goes stale immediately.
    const d = previewAgentSpend({ key: key(), amountUsd: 50, category: "travel", now: NOW });
    expect(d.wouldAllow).toBe(true);
    expect(d.serverMustDecide).toBe(true);
  });

  it("does not claim the server must decide when it has already refused", () => {
    const d = previewAgentSpend({ key: key(), amountUsd: 5000, category: "travel", now: NOW });
    expect(d.wouldAllow).toBe(false);
    expect(d.serverMustDecide).toBe(false);
  });
});

describe("previewAgentSpend — refusals mirror the server's reason codes", () => {
  it("refuses an unregistered key", () => {
    expect(previewAgentSpend({ key: null, amountUsd: 10, category: "travel", now: NOW })).toMatchObject(
      { wouldAllow: false, reason: "unknown_agent_key" }
    );
  });

  it("refuses a revoked key", () => {
    const d = previewAgentSpend({
      key: key({ status: "revoked" }),
      amountUsd: 10,
      category: "travel",
      now: NOW,
    });
    expect(d.reason).toBe<DenyReason>("key_revoked");
  });

  it("refuses an expired key even if the stored status still says active", () => {
    const d = previewAgentSpend({
      key: key({ policy: { ...key().policy, expiresAt: "2026-01-01T00:00:00Z" } }),
      amountUsd: 10,
      category: "travel",
      now: NOW,
    });
    expect(d.reason).toBe<DenyReason>("key_expired");
  });

  it("refuses a category the policy does not list", () => {
    const d = previewAgentSpend({ key: key(), amountUsd: 10, category: "transfer", now: NOW });
    expect(d.reason).toBe<DenyReason>("category_not_allowed");
  });

  it("refuses crypto transfers for a travel-only agent", () => {
    // The brief's worked example: Hotels ALLOWED, Crypto BLOCKED.
    const travelOnly = key({
      policy: { perTxLimitUsd: 300, dailyBudgetUsd: 1000, allowedCategories: ["travel"] },
    });
    expect(
      previewAgentSpend({ key: travelOnly, amountUsd: 100, category: "travel", now: NOW }).wouldAllow
    ).toBe(true);
    expect(
      previewAgentSpend({ key: travelOnly, amountUsd: 100, category: "transfer", now: NOW }).reason
    ).toBe("category_not_allowed");
  });

  it("refuses an over-limit single payment", () => {
    const d = previewAgentSpend({ key: key(), amountUsd: 300.01, category: "travel", now: NOW });
    expect(d.reason).toBe<DenyReason>("per_tx_limit_exceeded");
  });

  it("allows exactly the limit — the server uses > not >=", () => {
    const d = previewAgentSpend({ key: key(), amountUsd: 300, category: "travel", now: NOW });
    expect(d.wouldAllow).toBe(true);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])("refuses invalid amount %p", (amt) => {
    const d = previewAgentSpend({ key: key(), amountUsd: amt, category: "travel", now: NOW });
    expect(d.reason).toBe<DenyReason>("invalid_amount");
  });

  it("checks amount validity BEFORE the limit, like the server does", () => {
    // Order matters: Infinity > perTxLimit is true, so a limit check first
    // would report the wrong reason.
    const d = previewAgentSpend({ key: key(), amountUsd: Infinity, category: "travel", now: NOW });
    expect(d.reason).toBe("invalid_amount");
  });

  it("refuses everything for a read-only key", () => {
    const ro = key({ policy: { perTxLimitUsd: 300, dailyBudgetUsd: 1000, allowedCategories: [] } });
    for (const c of AGENT_SPEND_CATEGORIES) {
      expect(previewAgentSpend({ key: ro, amountUsd: 1, category: c, now: NOW }).wouldAllow).toBe(
        false
      );
    }
  });
});

describe("explainDenial", () => {
  it("names the rule that fired for every reason code", () => {
    const reasons: DenyReason[] = [
      "unknown_agent_key",
      "key_revoked",
      "key_expired",
      "category_not_allowed",
      "invalid_amount",
      "per_tx_limit_exceeded",
      "daily_budget_exceeded",
      "counter_unavailable",
    ];
    for (const r of reasons) {
      const msg = explainDenial(r, key());
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).not.toContain("undefined");
      expect(msg).not.toMatch(/_/); // no raw reason codes leaking to the user
    }
  });

  it("quotes the actual limit so the user knows what to change", () => {
    expect(explainDenial("per_tx_limit_exceeded", key())).toContain("$300");
    expect(explainDenial("daily_budget_exceeded", key())).toContain("$1,000");
  });

  it("does not blame the user when the server's counter was unavailable", () => {
    const msg = explainDenial("counter_unavailable");
    expect(msg).toMatch(/not made|could not/i);
  });

  it("works without a key record", () => {
    expect(() => explainDenial("per_tx_limit_exceeded", null)).not.toThrow();
  });
});

describe("requiresHumanApproval — the user's own threshold, above the hard caps", () => {
  it("pauses above the threshold", () => {
    expect(requiresHumanApproval(key(), 301, 300)).toBe(true);
  });

  it("does not pause at or below it", () => {
    expect(requiresHumanApproval(key(), 300, 300)).toBe(false);
    expect(requiresHumanApproval(key(), 10, 300)).toBe(false);
  });

  it("never pauses when no threshold is set", () => {
    expect(requiresHumanApproval(key(), 999999, null)).toBe(false);
  });

  it("asks when the amount is unknown rather than assuming it is small", () => {
    expect(requiresHumanApproval(key(), NaN, 300)).toBe(true);
  });
});

describe("key state helpers", () => {
  it("identifies a read-only key", () => {
    expect(isReadOnly(key({ policy: { ...key().policy, allowedCategories: [] } }))).toBe(true);
    expect(isReadOnly(key())).toBe(false);
  });

  it("identifies expiry independently of stored status", () => {
    const k = key({ policy: { ...key().policy, expiresAt: "2026-01-01T00:00:00Z" } });
    expect(isExpired(k, NOW)).toBe(true);
    expect(isUsable(k, NOW)).toBe(false);
  });

  it("treats a key with no expiry as never expired", () => {
    expect(isExpired(key(), NOW)).toBe(false);
    expect(isUsable(key(), NOW)).toBe(true);
  });
});

describe("validatePolicy", () => {
  it("accepts a sane policy", () => {
    expect(validatePolicy(key().policy)).toEqual([]);
  });

  it("rejects non-positive limits", () => {
    expect(
      validatePolicy({ perTxLimitUsd: 0, dailyBudgetUsd: 100, allowedCategories: [] })
    ).toContainEqual(expect.stringContaining("single-payment limit"));
    expect(
      validatePolicy({ perTxLimitUsd: 10, dailyBudgetUsd: -5, allowedCategories: [] })
    ).toContainEqual(expect.stringContaining("daily budget"));
  });

  it("flags a per-tx limit that can never bind", () => {
    // Reads stricter than it is — the daily budget would always fire first.
    const errs = validatePolicy({
      perTxLimitUsd: 5000,
      dailyBudgetUsd: 1000,
      allowedCategories: ["travel"],
    });
    expect(errs).toContainEqual(expect.stringContaining("never apply"));
  });

  it("rejects an unknown category", () => {
    const errs = validatePolicy({
      perTxLimitUsd: 10,
      dailyBudgetUsd: 100,
      allowedCategories: ["gambling" as never],
    });
    expect(errs).toContainEqual(expect.stringContaining("Unknown category"));
  });

  it("rejects an expiry in the past or an unparseable date", () => {
    expect(
      validatePolicy({ ...key().policy, expiresAt: "2020-01-01T00:00:00Z" })
    ).toContainEqual(expect.stringContaining("in the past"));
    expect(validatePolicy({ ...key().policy, expiresAt: "not-a-date" })).toContainEqual(
      expect.stringContaining("not a valid date")
    );
  });
});
