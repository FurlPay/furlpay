import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Route-level proof that /api/webhooks/stripe moves money at most once.
//
// Runs the REAL route, the REAL withDurableWebhook wrapper and the REAL
// lib/webhookEvents client. Only the edges are doubled:
//   · sbRpc — an in-memory implementation of the three RPCs in migration 0022
//     that mirrors their SQL semantics: UNIQUE(provider, id) claim, reclaim of a
//     'failed' or stale 'processing' row, and reclaim ONLY for the same payload
//     hash. The check-and-set runs synchronously inside the call, which is the
//     same atomicity the database gives a single INSERT … ON CONFLICT.
//   · webhookGuard (KV) — switchable between working, "open" (an outage or
//     eviction that lets everything through) and "throwing".
//   · recordMovement — the ledger write. Its call count IS the financial effect.
// ---------------------------------------------------------------------------

const S = vi.hoisted(() => {
  type Row = { status: string; hash: string; startedAt: number; attempts: number };
  return {
    backend: "supabase" as string,
    dbDown: false,
    now: 1_000_000_000_000,
    rows: new Map<string, Row>(),
    kvMode: "working" as "working" | "open" | "throw",
    kv: new Map<string, string>(),
    movements: [] as unknown[],
  };
});

const STALE_MS = 15 * 60_000;

vi.mock("@/lib/supabase", () => ({
  get supabaseBackend() {
    return S.backend;
  },
  sbRpc: vi.fn(async (fn: string, a: Record<string, string>) => {
    if (S.dbDown) throw new Error("connect ECONNREFUSED");
    const key = `${a.p_provider}|${a.p_provider_event_id}`;
    const row = S.rows.get(key);
    if (fn === "claim_webhook_event") {
      if (!row) {
        S.rows.set(key, { status: "processing", hash: a.p_payload_hash, startedAt: S.now, attempts: 1 });
        return [{ claimed: true, duplicate: false, existing_status: "processing", payload_mismatch: false }];
      }
      const reclaimable =
        (row.status === "failed" || (row.status === "processing" && row.startedAt < S.now - STALE_MS)) &&
        row.hash === a.p_payload_hash;
      if (reclaimable) {
        row.status = "processing";
        row.startedAt = S.now;
        row.attempts += 1;
        return [{ claimed: true, duplicate: false, existing_status: "processing", payload_mismatch: false }];
      }
      return [
        { claimed: false, duplicate: true, existing_status: row.status, payload_mismatch: row.hash !== a.p_payload_hash },
      ];
    }
    if (fn === "mark_webhook_processed" && row) row.status = "processed";
    if (fn === "mark_webhook_failed" && row) row.status = "failed";
    return undefined;
  }),
}));

vi.mock("@/lib/webhookGuard", () => ({
  tryBegin: vi.fn(async (id: string) => {
    if (S.kvMode === "throw") throw new Error("upstash unavailable");
    if (S.kvMode === "open") return true;
    if (S.kv.has(id)) return false;
    S.kv.set(id, "processing");
    return true;
  }),
  markProcessed: vi.fn(async (id: string) => {
    if (S.kvMode === "working") S.kv.set(id, "processed");
  }),
  markFailed: vi.fn(async (id: string) => {
    if (S.kvMode === "working") S.kv.delete(id);
  }),
}));

vi.mock("@/lib/payments/stripe", () => ({
  getStripe: () => ({
    webhooks: {
      constructEvent: (payload: string, sig: string) => {
        if (sig !== "valid-signature") throw new Error("No signatures found matching the expected signature");
        return JSON.parse(payload);
      },
    },
  }),
}));

vi.mock("@/lib/ledger", () => ({
  recordMovement: vi.fn(async (...args: unknown[]) => {
    S.movements.push(args);
    return { id: "lx_mock", applied: true };
  }),
}));

vi.mock("@/lib/store", () => ({
  getAccountDurable: vi.fn(async (id: string) => (id ? { user: { id } } : null)),
  getDevelopmentDemoAccount: () => null,
  newTx: (t: unknown) => t,
  recordTransaction: vi.fn(),
  setSubscriptionTier: vi.fn(),
}));
vi.mock("@/lib/entitlements", () => ({ TIER_BY_PLAN: {} }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/log", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/revenue/record", () => ({ recordRevenue: vi.fn(async () => undefined), minor: vi.fn() }));

import { POST } from "../route";
import { recordMovement } from "@/lib/ledger";
import { audit } from "@/lib/audit";

function eventBody(id: string, amount = 5000): string {
  return JSON.stringify({
    id,
    type: "payment_intent.succeeded",
    data: { object: { id: `pi_${id}`, amount, amount_received: amount, currency: "usd", metadata: { furlpayUserId: "user_1" } } },
  });
}

function deliver(body: string, signature = "valid-signature") {
  return POST(
    new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      body,
      headers: { "stripe-signature": signature },
    })
  );
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_real_value";
  S.backend = "supabase";
  S.dbDown = false;
  S.now = 1_000_000_000_000;
  S.rows.clear();
  S.kvMode = "working";
  S.kv.clear();
  S.movements.length = 0;
  vi.mocked(recordMovement).mockClear();
  vi.mocked(audit).mockClear();
});

describe("stripe webhook — durable dedupe at the route", () => {
  it("first delivery: one ledger movement, one durable row marked processed", async () => {
    const res = await deliver(eventBody("evt_1"));
    expect(res.status).toBe(200);
    expect(S.movements).toHaveLength(1);
    expect(S.rows.size).toBe(1);
    expect(S.rows.get("stripe|evt_1")?.status).toBe("processed");
  });

  it("sequential duplicate: acknowledged, no second movement", async () => {
    await deliver(eventBody("evt_1"));
    const res = await deliver(eventBody("evt_1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deduped: true });
    expect(S.movements).toHaveLength(1);
    expect(S.rows.size).toBe(1);
  });

  it("50 concurrent deliveries of one event with the KV guard OPEN: exactly one movement", async () => {
    // KV "open" models an Upstash outage or eviction: it waves everything
    // through, so the durable Postgres claim is the only thing left.
    S.kvMode = "open";
    const body = eventBody("evt_race");
    const responses = await Promise.all(Array.from({ length: 50 }, () => deliver(body)));
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(S.movements).toHaveLength(1);
    expect(S.rows.size).toBe(1);
    expect(S.rows.get("stripe|evt_race")?.status).toBe("processed");
  });

  it("same id, different body: 400, no movement, audited as payload_mismatch", async () => {
    await deliver(eventBody("evt_1", 5000));
    const res = await deliver(eventBody("evt_1", 999_999));
    expect(res.status).toBe(400);
    expect(S.movements).toHaveLength(1);
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      "webhook.payload_mismatch",
      "system",
      expect.objectContaining({ provider: "stripe" })
    );
  });

  it("durable store unavailable: 503, NO movement (fail closed)", async () => {
    S.dbDown = true;
    const res = await deliver(eventBody("evt_1"));
    expect(res.status).toBe(503);
    expect(S.movements).toHaveLength(0);
  });

  it("KV throwing: 500, NO movement (fail closed), durable row released for retry", async () => {
    S.kvMode = "throw";
    const res = await deliver(eventBody("evt_1"));
    expect(res.status).toBe(500);
    expect(S.movements).toHaveLength(0);
    expect(S.rows.get("stripe|evt_1")?.status).toBe("failed");
  });

  it("handler failure then provider retry: exactly one movement in total", async () => {
    vi.mocked(recordMovement).mockRejectedValueOnce(new Error("ledger write failed"));
    const first = await deliver(eventBody("evt_1"));
    expect(first.status).toBe(500);
    expect(S.rows.get("stripe|evt_1")?.status).toBe("failed");

    const retry = await deliver(eventBody("evt_1"));
    expect(retry.status).toBe(200);
    expect(S.movements).toHaveLength(1);
    expect(S.rows.get("stripe|evt_1")?.status).toBe("processed");
  });

  it("stale claim: a live 'processing' row blocks redelivery until the stale window passes", async () => {
    // A worker claimed and then died before running the effect.
    S.rows.set("stripe|evt_1", {
      status: "processing",
      hash: (await import("@/lib/webhookEvents")).webhookPayloadHash(eventBody("evt_1")),
      startedAt: S.now,
      attempts: 1,
    });
    const early = await deliver(eventBody("evt_1"));
    expect(early.status).toBe(200);
    expect(S.movements).toHaveLength(0); // still owned by the (dead) worker

    S.now += STALE_MS + 1;
    const recovered = await deliver(eventBody("evt_1"));
    expect(recovered.status).toBe(200);
    expect(S.movements).toHaveLength(1);
    expect(S.rows.get("stripe|evt_1")?.status).toBe("processed");
  });

  it("crash AFTER the effect, before mark-processed: stale reclaim does not pay twice (KV layer holds)", async () => {
    // State a crash leaves behind: the effect ran, KV still says 'processing',
    // the durable row is stale 'processing'.
    const body = eventBody("evt_1");
    const { webhookPayloadHash } = await import("@/lib/webhookEvents");
    S.rows.set("stripe|evt_1", { status: "processing", hash: webhookPayloadHash(body), startedAt: S.now, attempts: 1 });
    S.kv.set("evt_1", "processing");
    S.now += STALE_MS + 1;

    const res = await deliver(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deduped: true });
    expect(S.movements).toHaveLength(0);
  });

  it("invalid signature: 400, never reaches the durable store", async () => {
    const res = await deliver(eventBody("evt_1"), "forged");
    expect(res.status).toBe(400);
    expect(S.rows.size).toBe(0);
    expect(S.movements).toHaveLength(0);
  });

  it("store not provisioned (dev/test): durable layer bypassed, KV path unchanged", async () => {
    S.backend = "memory";
    await deliver(eventBody("evt_1"));
    const dup = await deliver(eventBody("evt_1"));
    expect(await dup.json()).toMatchObject({ deduped: true });
    expect(S.movements).toHaveLength(1);
    expect(S.rows.size).toBe(0);
  });
});
