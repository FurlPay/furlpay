import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock external dependencies BEFORE importing the modules under test.
// ---------------------------------------------------------------------------

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auditDb", () => ({ enqueueAudit: vi.fn() }));
vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

// A deterministic, in-process KV for agent spend and burst tests. The real
// vi.mock must intercept `@/lib/kv` so that agentPolicy.ts, burstWindow.ts,
// etc. all see the same controllable store.
const kvStore = new Map<string, unknown>();
vi.mock("@/lib/kv", () => ({
  kvGet: vi.fn(async (key: string) => kvStore.get(key) ?? null),
  kvSet: vi.fn(async (key: string, value: unknown) => {
    kvStore.set(key, value);
  }),
  kvIncrBy: vi.fn(async (key: string, amount: number, _ttl?: number) => {
    const current = (kvStore.get(key) as number) ?? 0;
    const next = current + amount;
    kvStore.set(key, next);
    return next;
  }),
  kvDel: vi.fn(async (key: string) => kvStore.delete(key)),
  kvSetNx: vi.fn(async (key: string, value: unknown, _ttl?: number) => {
    if (kvStore.has(key)) return false;
    kvStore.set(key, value);
    return true;
  }),
}));

// Mock compliance screening — no network calls.
vi.mock("@/lib/compliance/addressScreening", () => ({
  screenAddressRisk: vi.fn().mockResolvedValue({
    action: "allow",
    risk: "low",
    categories: [],
    reasons: [],
  }),
}));

// Mock chain registry for payment service.
vi.mock("@/lib/services/chainRegistry", () => ({
  getChain: vi.fn(() => ({ chainId: 42161, name: "Arbitrum One" })),
  gasQuote: vi.fn().mockResolvedValue({ transferCostUsd: 0.05 }),
}));

// Mock the store and ledger to prevent real persistence.
vi.mock("@/lib/store", () => ({
  newTx: vi.fn((t: unknown) => t),
  recordTransaction: vi.fn(),
}));
vi.mock("@/lib/ledger", () => ({
  recordPaymentWithFee: vi.fn().mockResolvedValue({ id: "ledger_tx_1" }),
  reverseLedgerTx: vi.fn().mockResolvedValue({ id: "ledger_tx_2" }),
}));
vi.mock("@/lib/integrations", () => ({
  mockAllowed: vi.fn(() => true),
  IntegrationNotConfiguredError: class extends Error {},
}));
vi.mock("@/lib/flags", () => ({
  financialEnvironment: vi.fn(() => "development"),
}));

// Mock @furlpay/agent-trust — we only need keyIdOf for deterministic key IDs.
vi.mock("@furlpay/agent-trust", () => ({
  keyIdOf: vi.fn(
    (pem: string, role: string) =>
      `${role === "user" ? "uk" : "ak"}_${pem.slice(0, 12).replace(/[^a-zA-Z0-9]/g, "x")}`,
  ),
}));

import * as kv from "@/lib/kv";
import { audit } from "@/lib/audit";
import { screenAddressRisk } from "@/lib/compliance/addressScreening";
import {
  authorizeAgentSpend,
  getAgentKey,
  redactAgentKey,
  registerOwnedAgentKey,
  revokeAgentKey,
  type AgentKeyRecord,
  type AgentPolicy,
  type AgentSpendCategory,
} from "@/lib/agentPolicy";
import { mcpDenialFor, requiredScopeFor } from "@/lib/mcp/routeScopes";
import type { McpClaims } from "@/lib/mcp/oauth";
import {
  createPayment,
  executePayment,
  approvePayment,
  rejectPayment,
  getPayment,
} from "@/lib/services/payments";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_POLICY: AgentPolicy = {
  perTxLimitUsd: 50,
  dailyBudgetUsd: 200,
  allowedCategories: ["transfer", "escrow"],
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

const TEST_PEM = "-----BEGIN PUBLIC KEY-----TEST_PEM_1-----END PUBLIC KEY-----";

async function seedActiveKey(
  overrides: Partial<AgentPolicy> = {},
  pem = TEST_PEM,
): Promise<AgentKeyRecord> {
  const policy = { ...DEFAULT_POLICY, ...overrides };
  return registerOwnedAgentKey({
    userId: "user-1",
    name: "test-key",
    publicKeyPem: pem,
    policy,
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  kvStore.clear();
  vi.clearAllMocks();
  // Reset the globalThis payment stores between tests.
  const g = globalThis as unknown as {
    __furlpayPayments?: Map<string, unknown>;
    __furlpayIdem?: Map<string, string>;
  };
  g.__furlpayPayments?.clear();
  g.__furlpayIdem?.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// 1. AGENT SPEND POLICY BYPASS ATTEMPTS
// ===========================================================================

describe("agent spend policy bypass attempts", () => {
  it("negative amounts are denied as invalid_amount", async () => {
    const key = await seedActiveKey();
    const result = await authorizeAgentSpend({
      keyId: key.keyId,
      amountUsd: -10,
      category: "transfer",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("invalid_amount");
    }
  });

  it("NaN amount is denied as invalid_amount", async () => {
    const key = await seedActiveKey();
    const result = await authorizeAgentSpend({
      keyId: key.keyId,
      amountUsd: NaN,
      category: "transfer",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("invalid_amount");
  });

  it("Infinity amount is denied as invalid_amount", async () => {
    const key = await seedActiveKey();
    const result = await authorizeAgentSpend({
      keyId: key.keyId,
      amountUsd: Infinity,
      category: "transfer",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("invalid_amount");
  });

  it("negative Infinity amount is denied as invalid_amount", async () => {
    const key = await seedActiveKey();
    const result = await authorizeAgentSpend({
      keyId: key.keyId,
      amountUsd: -Infinity,
      category: "transfer",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("invalid_amount");
  });

  it("zero amount is denied as invalid_amount", async () => {
    const key = await seedActiveKey();
    const result = await authorizeAgentSpend({
      keyId: key.keyId,
      amountUsd: 0,
      category: "transfer",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("invalid_amount");
  });

  it("amount exceeding per-tx limit is denied", async () => {
    const key = await seedActiveKey({ perTxLimitUsd: 25 });
    const result = await authorizeAgentSpend({
      keyId: key.keyId,
      amountUsd: 26,
      category: "transfer",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("per_tx_limit_exceeded");
  });

  it("spending with a revoked key is denied", async () => {
    const key = await seedActiveKey();
    await revokeAgentKey("user-1", key.keyId);
    const result = await authorizeAgentSpend({
      keyId: key.keyId,
      amountUsd: 5,
      category: "transfer",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("key_revoked");
  });

  it("spending with an expired key is denied", async () => {
    const key = await seedActiveKey({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const result = await authorizeAgentSpend({
      keyId: key.keyId,
      amountUsd: 5,
      category: "transfer",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("key_expired");
  });

  it("category not in allowedCategories is denied", async () => {
    const key = await seedActiveKey({ allowedCategories: ["escrow"] });
    const result = await authorizeAgentSpend({
      keyId: key.keyId,
      amountUsd: 5,
      category: "travel" as AgentSpendCategory,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("category_not_allowed");
  });

  it("unknown key id is denied", async () => {
    const result = await authorizeAgentSpend({
      keyId: "ak_nonexistent_key_id",
      amountUsd: 5,
      category: "transfer",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("unknown_agent_key");
  });

  it("budget counter unavailable fails closed (deny)", async () => {
    const key = await seedActiveKey();
    // Make kvIncrBy throw to simulate Redis outage.
    vi.mocked(kv.kvIncrBy).mockRejectedValueOnce(new Error("Redis connection refused"));
    const result = await authorizeAgentSpend({
      keyId: key.keyId,
      amountUsd: 5,
      category: "transfer",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toMatch(/budget_counter_unavailable|burst_store_unavailable/);
    }
  });

  it("concurrent spends never exceed daily budget", async () => {
    const key = await seedActiveKey({
      perTxLimitUsd: 100,
      dailyBudgetUsd: 100,
      allowedCategories: ["transfer"],
    });
    // Fire 5 concurrent spends of $30 each ($150 total > $100 budget).
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        authorizeAgentSpend({
          keyId: key.keyId,
          amountUsd: 30,
          category: "transfer",
        }),
      ),
    );
    const allowed = results.filter((r) => r.allowed);
    // At most 3 × $30 = $90 can be allowed (the 4th would exceed $100).
    // spentTodayUsd is each spend's RUNNING total, so the invariant is on the
    // amounts allowed and on the highest running total — summing the running
    // totals (30 + 60 + 90) double-counts and is not a budget figure.
    expect(allowed.length).toBeLessThanOrEqual(3);
    expect(allowed.length * 30).toBeLessThanOrEqual(100);
    const highest = Math.max(0, ...allowed.map((r) => (r.allowed ? r.spentTodayUsd : 0)));
    expect(highest).toBeLessThanOrEqual(100);
  });

  it("burst rate prevents rapid-fire draining of a large budget", async () => {
    // Budget is $400/day, per-tx $20 — burst cap is 25% of budget = $100,
    // floor'd at perTxLimit. Rapid-fire $20 spends should eventually be
    // rate-limited even if the daily budget has room.
    const key = await seedActiveKey({
      perTxLimitUsd: 20,
      dailyBudgetUsd: 400,
      allowedCategories: ["transfer"],
    });
    const results: Awaited<ReturnType<typeof authorizeAgentSpend>>[] = [];
    // 30 sequential $20 spends = $600 attempted against $400 budget.
    for (let i = 0; i < 30; i++) {
      results.push(
        await authorizeAgentSpend({
          keyId: key.keyId,
          amountUsd: 20,
          category: "transfer",
        }),
      );
    }
    const denied = results.filter((r) => !r.allowed);
    expect(denied.length).toBeGreaterThan(0);
    // At least some denials should be burst- or budget-related.
    const reasons = denied.map((r) => (!r.allowed ? r.reason : ""));
    expect(
      reasons.some(
        (r) =>
          r === "burst_rate_exceeded" ||
          r === "daily_budget_exceeded",
      ),
    ).toBe(true);
  });

  it("every denial emits an audit event", async () => {
    await authorizeAgentSpend({
      keyId: "ak_ghost",
      amountUsd: 5,
      category: "transfer",
    });
    expect(audit).toHaveBeenCalledWith(
      "agent.spend_denied",
      expect.any(String),
      expect.objectContaining({ reason: "unknown_agent_key" }),
    );
  });
});

// ===========================================================================
// 2. MCP SCOPE ESCALATION ATTEMPTS
// ===========================================================================

describe("MCP scope escalation attempts", () => {
  const claims = (scopes: string[]): McpClaims =>
    ({ sub: "user-1", mcp: true, scopes } as McpClaims);

  it("connector token cannot access unmapped routes", () => {
    // /api/security/mfa is NOT in ROUTE_SCOPES — must be denied.
    const denial = mcpDenialFor(claims(["wallets:read"]), "POST", "/api/security/mfa");
    expect(denial).not.toBeNull();
    expect(denial!.status).toBe(403);
  });

  it("wallets:read token cannot access payments:write routes", () => {
    const denial = mcpDenialFor(claims(["wallets:read"]), "POST", "/api/payments/create");
    expect(denial).not.toBeNull();
    expect(denial!.status).toBe(403);
  });

  it("swap execute route is NOT accessible via MCP", () => {
    // /api/swaps/execute is deliberately NOT mapped — quoting is read, execution is not.
    const scope = requiredScopeFor("POST", "/api/swaps/execute");
    expect(scope).toBeNull();
    const denial = mcpDenialFor(claims(["wallets:read", "payments:write"]), "POST", "/api/swaps/execute");
    expect(denial).not.toBeNull();
  });

  it("security/MFA endpoints are NOT accessible via MCP tokens", () => {
    for (const path of ["/api/security/mfa", "/api/auth/session", "/api/auth/login"]) {
      const scope = requiredScopeFor("POST", path);
      expect(scope).toBeNull();
      const denial = mcpDenialFor(claims(["wallets:read", "payments:write"]), "POST", path);
      expect(denial).not.toBeNull();
    }
  });

  it("a token with only transactions:read cannot reach wallets:read routes", () => {
    const denial = mcpDenialFor(claims(["transactions:read"]), "GET", "/api/wallets");
    expect(denial).not.toBeNull();
    expect(denial!.status).toBe(403);
  });

  it("admin routes are inaccessible via MCP even with all scopes", () => {
    const allScopes = [
      "profile:read",
      "wallets:read",
      "transactions:read",
      "payments:write",
      "travel:read",
      "investing:read",
    ];
    for (const path of ["/api/admin/users", "/api/control-plane/approvals"]) {
      const denial = mcpDenialFor(claims(allScopes), "GET", path);
      expect(denial).not.toBeNull();
    }
  });
});

// ===========================================================================
// 3. HITL GATEWAY INTEGRITY
// ===========================================================================

describe("HITL gateway integrity", () => {
  const PAYER = "0x1111111111111111111111111111111111111111";
  const RECIPIENT = "0x2222222222222222222222222222222222222222";
  const VALID_SIG = "0x" + "ab".repeat(32);

  async function createAndExecute(
    amountUsd: number,
    opts: {
      userId?: string;
      metadata?: Record<string, string>;
      payerScreenOverride?: Partial<{ action: string; risk: string }>;
      recipientScreenOverride?: Partial<{ action: string; risk: string }>;
    } = {},
  ) {
    const userId = opts.userId ?? "user-1";
    const { record } = await createPayment({
      amount: amountUsd,
      sourceChain: "arbitrum",
      recipient: RECIPIENT,
      userId,
      metadata: opts.metadata,
    });
    // Override screening responses per test.
    if (opts.payerScreenOverride || opts.recipientScreenOverride) {
      const mock = vi.mocked(screenAddressRisk);
      // First call = payer, second = recipient.
      mock
        .mockResolvedValueOnce({
          action: opts.payerScreenOverride?.action ?? "allow",
          risk: opts.payerScreenOverride?.risk ?? "low",
          categories: [],
          reasons: [],
        } as never)
        .mockResolvedValueOnce({
          action: opts.recipientScreenOverride?.action ?? "allow",
          risk: opts.recipientScreenOverride?.risk ?? "low",
          categories: [],
          reasons: [],
        } as never);
    }
    const result = await executePayment(record.id, PAYER, VALID_SIG, userId);
    return { result, record };
  }

  it("payment >= HITL threshold ($3000) returns pending_review", async () => {
    const { result } = await createAndExecute(3000);
    expect(result.record?.status).toBe("pending_review");
    expect(result.pending).toBe(true);
    expect(result.record?.reviewReason).toMatch(/amount_over_threshold/);
  });

  it("payment well above HITL threshold returns pending_review", async () => {
    const { result } = await createAndExecute(10_000);
    expect(result.record?.status).toBe("pending_review");
  });

  it("high-risk jurisdiction triggers review", async () => {
    const { result } = await createAndExecute(100, {
      metadata: { jurisdiction: "IR" },
    });
    expect(result.record?.status).toBe("pending_review");
    expect(result.record?.reviewReason).toMatch(/high_risk_jurisdiction/);
  });

  it("elevated counterparty risk triggers review", async () => {
    const { result } = await createAndExecute(100, {
      recipientScreenOverride: { action: "review", risk: "high" },
    });
    expect(result.record?.status).toBe("pending_review");
    expect(result.record?.reviewReason).toBe("elevated_counterparty_risk");
  });

  it("payer high risk also triggers review", async () => {
    const { result } = await createAndExecute(100, {
      payerScreenOverride: { risk: "high" },
    });
    expect(result.record?.status).toBe("pending_review");
    expect(result.record?.reviewReason).toBe("elevated_counterparty_risk");
  });

  it("reviewer CANNOT approve own payment (separation of duties)", async () => {
    const { result, record } = await createAndExecute(5000, { userId: "user-payer" });
    expect(result.record?.status).toBe("pending_review");
    const approval = await approvePayment(record.id, "user-payer");
    expect(approval.ok).toBe(false);
    expect(approval.error).toBe("reviewer_cannot_approve_own_payment");
  });

  it("already-settled payment cannot be re-approved (idempotent)", async () => {
    // Create a payment under the threshold so it settles immediately.
    const { record } = await createPayment({
      amount: 50,
      sourceChain: "arbitrum",
      recipient: RECIPIENT,
      userId: "user-1",
    });
    await executePayment(record.id, PAYER, VALID_SIG, "user-1");
    const payment = getPayment(record.id);
    expect(payment?.status).toBe("settled");
    // approvePayment on an already-settled record returns replayed success.
    const result = await approvePayment(record.id, "officer-1");
    expect(result.ok).toBe(true);
    expect(result.replayed).toBe(true);
  });

  it("already-blocked payment cannot be approved", async () => {
    // Create a large payment to trigger review, then reject it.
    const { record } = await createAndExecute(5000, { userId: "user-1" });
    rejectPayment(record.id, "officer-1", "suspicious");
    const payment = getPayment(record.id);
    expect(payment?.status).toBe("blocked");
    const result = await approvePayment(record.id, "officer-2");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("cannot_approve_blocked");
  });
});

// ===========================================================================
// 4. SECRETS EXPOSURE PREVENTION
// ===========================================================================

describe("secrets exposure prevention", () => {
  it("redactAgentKey strips the PEM from the public view", async () => {
    const record = await seedActiveKey();
    const publicView = redactAgentKey(record);
    expect(publicView).not.toHaveProperty("publicKeyPem");
    expect(publicView).not.toHaveProperty("userId");
    expect(publicView).toHaveProperty("keyId");
    expect(publicView).toHaveProperty("name");
    expect(publicView).toHaveProperty("policy");
    expect(publicView).toHaveProperty("status");
    expect(publicView).toHaveProperty("createdAt");
    // Ensure no stringified version leaks the PEM.
    const serialized = JSON.stringify(publicView);
    expect(serialized).not.toContain("BEGIN PUBLIC KEY");
    expect(serialized).not.toContain("END PUBLIC KEY");
  });

  it("agent key registration returns the record, but redacted form has no PEM", async () => {
    const record = await registerOwnedAgentKey({
      userId: "user-1",
      name: "my-agent",
      publicKeyPem: TEST_PEM,
      policy: DEFAULT_POLICY,
    });
    // The internal record has the PEM (needed for signature verification).
    expect(record.publicKeyPem).toBe(TEST_PEM);
    // The public-facing projection must NOT.
    const pub = redactAgentKey(record);
    expect(JSON.stringify(pub)).not.toContain(TEST_PEM);
  });
});

// ===========================================================================
// 5. IDEMPOTENCY UNDER ADVERSARIAL CONDITIONS
// ===========================================================================

describe("idempotency under adversarial conditions", () => {
  const RECIPIENT = "0x2222222222222222222222222222222222222222";

  it("same idempotency key from different users resolves to different payments", async () => {
    const SHARED_KEY = "idem-shared-key-1";
    const [a, b] = await Promise.all([
      createPayment({
        amount: 100,
        sourceChain: "arbitrum",
        recipient: RECIPIENT,
        userId: "user-alice",
        idempotencyKey: SHARED_KEY,
      }),
      createPayment({
        amount: 100,
        sourceChain: "arbitrum",
        recipient: RECIPIENT,
        userId: "user-bob",
        idempotencyKey: SHARED_KEY,
      }),
    ]);
    // Two different payment ids — cross-user isolation.
    expect(a.record.id).not.toBe(b.record.id);
    // Each user's retry with the same key resolves to THEIR OWN payment.
    const aliceAgain = await createPayment({ amount: 100, sourceChain: "arbitrum", recipient: RECIPIENT, userId: "user-alice", idempotencyKey: SHARED_KEY });
    const bobAgain = await createPayment({ amount: 100, sourceChain: "arbitrum", recipient: RECIPIENT, userId: "user-bob", idempotencyKey: SHARED_KEY });
    expect(aliceAgain.record.id).toBe(a.record.id);
    expect(bobAgain.record.id).toBe(b.record.id);
  });

  it("replayed idempotency key returns the original, not a duplicate", async () => {
    const IDEM_KEY = "idem-replay-test";
    const first = await createPayment({
      amount: 42,
      sourceChain: "arbitrum",
      recipient: RECIPIENT,
      userId: "user-1",
      idempotencyKey: IDEM_KEY,
    });
    const second = await createPayment({
      amount: 42,
      sourceChain: "arbitrum",
      recipient: RECIPIENT,
      userId: "user-1",
      idempotencyKey: IDEM_KEY,
    });
    // Same payment id returned — no duplicate charge.
    expect(second.record.id).toBe(first.record.id);
    expect(second.replayed).toBe(true);
  });

  it("replayed idempotency key does not create a second payment even with different amount", async () => {
    const IDEM_KEY = "idem-mismatch-test";
    const first = await createPayment({
      amount: 42,
      sourceChain: "arbitrum",
      recipient: RECIPIENT,
      userId: "user-1",
      idempotencyKey: IDEM_KEY,
    });
    // Second call with a different amount but same key — original is returned.
    const second = await createPayment({
      amount: 999,
      sourceChain: "arbitrum",
      recipient: RECIPIENT,
      userId: "user-1",
      idempotencyKey: IDEM_KEY,
    });
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.amountUsdc).toBe(42);
    expect(second.replayed).toBe(true);
  });
});
