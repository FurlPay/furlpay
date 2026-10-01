import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// T-W1 / T-W2 / T-W3 at the ROUTE (audit P0-1).
//
// The REAL /api/webhooks/stripe route, the REAL withDurableWebhook, the REAL
// lib/webhookEvents client and the REAL lib/ledger applyFinancialEffect. Only
// the database is doubled — an in-memory model of the SQL in migrations
// 0022/0024 (claim) and 0025 (apply_financial_effect: unique effect key, ack in
// the same transaction). Those SQL semantics are proven on real PostgreSQL 18
// with 20 concurrent connections by scripts/db/verify-financial-effects.mjs;
// this file proves the APPLICATION drives them correctly: the right effect
// key, the ack passed into the effect, success on an ack failure, success on a
// duplicate, and no reliance on KV.
// ---------------------------------------------------------------------------

const S = vi.hoisted(() => {
  type Row = { status: string; hash: string; startedAt: number };
  return {
    rows: new Map<string, Row>(),
    effects: new Map<string, { memo: string; postings: unknown[]; ack: string | null }>(),
    effectCalls: [] as { key: string; provider: string | null; eventId: string | null }[],
    failMarkProcessed: 0,
    kvMode: "working" as "working" | "open",
    kv: new Map<string, string>(),
    activity: [] as unknown[],
    now: 1_000_000_000_000,
  };
});

vi.mock("@/lib/supabase", () => ({
  supabaseBackend: "supabase",
  sbSelect: vi.fn(async () => []),
  sbRpc: vi.fn(async (fn: string, a: Record<string, unknown>) => {
    const key = `${a.p_provider}|${a.p_provider_event_id}`;
    const row = S.rows.get(key);
    if (fn === "claim_webhook_event") {
      if (!row) {
        S.rows.set(key, { status: "processing", hash: String(a.p_payload_hash), startedAt: S.now });
        return [{ claimed: true, duplicate: false, existing_status: "processing", payload_mismatch: false }];
      }
      const reclaimable = (row.status === "failed" || (row.status === "processing" && row.startedAt < S.now - 900_000)) && row.hash === a.p_payload_hash;
      if (reclaimable) {
        row.status = "processing";
        row.startedAt = S.now;
        return [{ claimed: true, duplicate: false, existing_status: "processing", payload_mismatch: false }];
      }
      return [{ claimed: false, duplicate: true, existing_status: row.status, payload_mismatch: row.hash !== a.p_payload_hash }];
    }
    if (fn === "mark_webhook_processed") {
      if (S.failMarkProcessed > 0) {
        S.failMarkProcessed--;
        throw new Error("PostgREST 504 on mark_webhook_processed");
      }
      if (row) row.status = "processed";
      return undefined;
    }
    if (fn === "mark_webhook_failed") {
      if (row) row.status = "failed";
      return undefined;
    }
    if (fn === "apply_financial_effect") {
      // 0025: one row per effect key (unique index); ack in the same transaction.
      const k = String(a.p_effect_key);
      S.effectCalls.push({ key: k, provider: (a.p_provider as string) ?? null, eventId: (a.p_event_id as string) ?? null });
      const ackKey = a.p_provider ? `${a.p_provider}|${a.p_event_id}` : null;
      const ack = () => {
        if (ackKey && S.rows.get(ackKey)) S.rows.get(ackKey)!.status = "processed";
      };
      if (S.effects.has(k)) {
        ack();
        return [{ applied: false, ledger_tx_id: `lx_${k}` }];
      }
      S.effects.set(k, { memo: String(a.p_memo), postings: a.p_postings as unknown[], ack: ackKey });
      ack();
      return [{ applied: true, ledger_tx_id: `lx_${k}` }];
    }
    throw new Error(`unexpected rpc ${fn}`);
  }),
}));

vi.mock("@/lib/paymentsDb", () => ({
  paymentsDurable: () => true,
  ensureLedgerAccount: vi.fn(async () => undefined),
  postLedgerTransaction: vi.fn(async () => {
    throw new Error("un-keyed posting must not be used for a Stripe credit");
  }),
}));

vi.mock("@/lib/webhookGuard", () => ({
  tryBegin: vi.fn(async (id: string) => {
    if (S.kvMode === "open") return true;
    if (S.kv.has(id)) return false;
    S.kv.set(id, "processing");
    return true;
  }),
  markProcessed: vi.fn(async (id: string) => {
    if (S.kvMode === "working") S.kv.set(id, "processed");
  }),
  markFailed: vi.fn(async (id: string) => {
    S.kv.delete(id);
  }),
}));

vi.mock("@/lib/payments/stripe", () => ({
  getStripe: () => ({
    webhooks: {
      constructEvent: (payload: string, sig: string) => {
        if (sig !== "valid-signature") throw new Error("bad signature");
        return JSON.parse(payload);
      },
    },
  }),
}));

vi.mock("@/lib/store", () => ({
  DEMO_USER_ID: "demo",
  InsufficientBalanceError: class extends Error {},
  applyTokenBalanceDeltaInMemory: vi.fn(),
  getAccount: vi.fn(() => undefined),
  refreshTokenBalancesFromDb: vi.fn(async () => undefined),
  getAccountDurable: vi.fn(async (id: string) => (id ? { user: { id } } : null)),
  getDevelopmentDemoAccount: () => null,
  newTx: (t: unknown) => t,
  recordTransaction: vi.fn((_u: string, t: unknown) => S.activity.push(t)),
  setSubscriptionTier: vi.fn(),
}));
vi.mock("@/lib/entitlements", () => ({ TIER_BY_PLAN: {} }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/log", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/revenue/record", () => ({ recordRevenue: vi.fn(async () => undefined), minor: vi.fn() }));

import { POST } from "../route";
import { log } from "@/lib/log";

function body(eventId: string, piId: string, currency = "usd", amount = 5000): string {
  return JSON.stringify({
    id: eventId,
    type: "payment_intent.succeeded",
    data: { object: { id: piId, amount, amount_received: amount, currency, metadata: { furlpayUserId: "user_1" } } },
  });
}
const deliver = (b: string) =>
  POST(new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: b, headers: { "stripe-signature": "valid-signature" } }));

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_real_value";
  S.rows.clear();
  S.effects.clear();
  S.effectCalls.length = 0;
  S.activity.length = 0;
  S.failMarkProcessed = 0;
  S.kvMode = "working";
  S.kv.clear();
});

describe("Stripe PaymentIntent credit is exactly-once at the effect", () => {
  it("keys the effect on the PaymentIntent and acknowledges the event inside it", async () => {
    const res = await deliver(body("evt_1", "pi_A"));
    expect(res.status).toBe(200);
    expect(S.effectCalls).toEqual([{ key: "stripe:pi:pi_A", provider: "stripe", eventId: "evt_1" }]);
    expect(S.effects.size).toBe(1);
    expect(S.rows.get("stripe|evt_1")?.status).toBe("processed");
    expect(S.activity).toHaveLength(1);
  });

  it("T-W1: effect commits, the separate ack FAILS → 200 (not 5xx), and a redelivery still moves nothing", async () => {
    // Make the effect's in-transaction ack not happen (simulating an older
    // database path) AND the separate ack fail, the exact audited sequence.
    S.failMarkProcessed = 1;
    const first = await deliver(body("evt_2", "pi_B"));
    expect(first.status).toBe(200); // was 500 before: that 500 is what invited the double effect
    expect(vi.mocked(log.error)).toHaveBeenCalledWith(
      "durable webhook: ack failed after successful handler",
      expect.objectContaining({ provider: "stripe", eventId: "evt_2" })
    );
    // Force the worst case the audit described: the row ends up 'failed' and the
    // provider redelivers; 0022 re-claims it and the handler runs again.
    S.rows.get("stripe|evt_2")!.status = "failed";
    S.kv.clear(); // and the KV guard is gone too
    const second = await deliver(body("evt_2", "pi_B"));
    expect(second.status).toBe(200);
    expect(S.effectCalls).toHaveLength(2); // the handler DID run again…
    expect(S.effects.size).toBe(1); // …and the effect did not
    expect(S.activity).toHaveLength(1); // no second activity row either
    expect(S.rows.get("stripe|evt_2")?.status).toBe("processed");
  });

  it("T-W2: every KV dedupe key cleared between deliveries → one effect", async () => {
    await deliver(body("evt_3", "pi_C"));
    S.kv.clear();
    S.rows.clear(); // even the durable claim row gone: only the effect key remains
    const again = await deliver(body("evt_3", "pi_C"));
    expect(again.status).toBe(200);
    expect(S.effects.size).toBe(1);
    expect(S.activity).toHaveLength(1);
  });

  it("the same PaymentIntent under a DIFFERENT event id is still one effect", async () => {
    await deliver(body("evt_4a", "pi_D"));
    S.kvMode = "open";
    await deliver(body("evt_4b", "pi_D"));
    expect(S.effects.size).toBe(1);
  });

  it("T-W3: 20 concurrent identical deliveries, KV open → 20 successes, one effect", async () => {
    S.kvMode = "open";
    const results = await Promise.all(Array.from({ length: 20 }, () => deliver(body("evt_5", "pi_E"))));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(S.effects.size).toBe(1);
    expect(S.activity.length).toBeLessThanOrEqual(1);
  });

  it("a duplicate effect returns success, not an error", async () => {
    S.kvMode = "open";
    await deliver(body("evt_6", "pi_F"));
    S.rows.get("stripe|evt_6")!.status = "failed";
    const dup = await deliver(body("evt_6", "pi_F"));
    expect(dup.status).toBe(200);
    expect(S.effects.size).toBe(1);
  });

  it("a non-USD PaymentIntent is acknowledged but never credited", async () => {
    const res = await deliver(body("evt_7", "pi_G", "inr", 500000));
    expect(res.status).toBe(200);
    expect(S.effects.size).toBe(0);
  });
});
